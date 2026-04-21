#![no_std]
#![no_main]

use aya_ebpf::{
    bindings::xdp_action,
    helpers::bpf_ktime_get_ns,
    macros::{map, xdp},
    maps::HashMap,
    programs::XdpContext,
};
use core::{mem, ptr};

#[map(name = "PG_SATURATION")]
static mut PG_SATURATION: HashMap<u32, u32> = HashMap::with_max_entries(16, 0);

#[map(name = "DROP_COUNTER")]
static mut DROP_COUNTER: HashMap<u32, u64> = HashMap::with_max_entries(16, 0);

#[map(name = "DROP_MODE")]
static mut DROP_MODE: HashMap<u32, u32> = HashMap::with_max_entries(16, 0);

#[map(name = "TARGET_PORT")]
static mut TARGET_PORT: HashMap<u32, u32> = HashMap::with_max_entries(16, 0);

#[map(name = "BUCKET_TOKENS")]
static mut BUCKET_TOKENS: HashMap<u32, u64> = HashMap::with_max_entries(16, 0);

#[map(name = "BUCKET_REFILL_AT")]
static mut BUCKET_REFILL_AT: HashMap<u32, u64> = HashMap::with_max_entries(16, 0);

#[map(name = "BUCKET_BURST")]
static mut BUCKET_BURST: HashMap<u32, u32> = HashMap::with_max_entries(16, 0);

#[map(name = "BUCKET_REFILL_PER_SEC")]
static mut BUCKET_REFILL_PER_SEC: HashMap<u32, u32> = HashMap::with_max_entries(16, 0);

const KEY_GLOBAL: u32 = 1;
const SAFE_THRESHOLD: u32 = 80;
const ETH_LEN: usize = 14;
const IPV4_ETHERTYPE: u16 = 0x0800;
const IPPROTO_TCP: u8 = 6;
const IPPROTO_UDP: u8 = 17;
const NANOS_PER_SEC: u64 = 1_000_000_000;
const DEFAULT_BURST: u64 = 200;
const DEFAULT_REFILL_PER_SEC: u64 = 100;

#[xdp(name = "xdp_oci_guard")]
pub fn xdp_oci_guard(_ctx: XdpContext) -> u32 {
    match try_xdp_oci_guard(_ctx) {
        Ok(action) => action,
        Err(_) => xdp_action::XDP_PASS,
    }
}

fn try_xdp_oci_guard(ctx: XdpContext) -> Result<u32, i64> {
    let mode = unsafe { DROP_MODE.get(&KEY_GLOBAL).copied().unwrap_or(0) };
    if mode == 0 {
        return Ok(xdp_action::XDP_PASS);
    }

    let saturation = unsafe { PG_SATURATION.get(&KEY_GLOBAL).copied().unwrap_or(0) };
    if saturation < SAFE_THRESHOLD {
        return Ok(xdp_action::XDP_PASS);
    }

    if !matches_target_traffic(ctx)? {
        return Ok(xdp_action::XDP_PASS);
    }

    if consume_bucket_token()? {
        return Ok(xdp_action::XDP_PASS);
    }

    unsafe {
        let current = DROP_COUNTER.get(&KEY_GLOBAL).copied().unwrap_or(0);
        DROP_COUNTER.insert(&KEY_GLOBAL, &current.saturating_add(1), 0)?;
    }
    Ok(xdp_action::XDP_DROP)
}

fn matches_target_traffic(ctx: XdpContext) -> Result<bool, i64> {
    let data = ctx.data() as usize;
    let data_end = ctx.data_end() as usize;
    if data + ETH_LEN > data_end {
        return Ok(false);
    }

    let eth_type = read_u16_be(data + 12, data_end)?;
    if eth_type != IPV4_ETHERTYPE {
        return Ok(false);
    }

    let ip_base = data + ETH_LEN;
    let ver_ihl = read_u8(ip_base, data_end)?;
    let ihl_words = (ver_ihl & 0x0F) as usize;
    if ihl_words < 5 {
        return Ok(false);
    }
    let ip_hdr_len = ihl_words * 4;
    let proto = read_u8(ip_base + 9, data_end)?;
    if proto != IPPROTO_TCP && proto != IPPROTO_UDP {
        return Ok(false);
    }

    let l4_base = ip_base + ip_hdr_len;
    let dst_port = read_u16_be(l4_base + 2, data_end)? as u32;
    let target_port = unsafe { TARGET_PORT.get(&KEY_GLOBAL).copied().unwrap_or(443) };
    Ok(dst_port == target_port)
}

fn read_u8(addr: usize, data_end: usize) -> Result<u8, i64> {
    if addr + mem::size_of::<u8>() > data_end {
        return Err(0);
    }
    let ptr = addr as *const u8;
    Ok(unsafe { ptr::read_unaligned(ptr) })
}

fn read_u16_be(addr: usize, data_end: usize) -> Result<u16, i64> {
    if addr + mem::size_of::<u16>() > data_end {
        return Err(0);
    }
    let ptr = addr as *const u16;
    let raw = unsafe { ptr::read_unaligned(ptr) };
    Ok(u16::from_be(raw))
}

fn consume_bucket_token() -> Result<bool, i64> {
    let now = unsafe { bpf_ktime_get_ns() };
    let burst = unsafe {
        BUCKET_BURST
            .get(&KEY_GLOBAL)
            .copied()
            .map(|v| v as u64)
            .unwrap_or(DEFAULT_BURST)
    };
    let refill_per_sec = unsafe {
        BUCKET_REFILL_PER_SEC
            .get(&KEY_GLOBAL)
            .copied()
            .map(|v| v as u64)
            .unwrap_or(DEFAULT_REFILL_PER_SEC)
    };

    let last_refill_at = unsafe { BUCKET_REFILL_AT.get(&KEY_GLOBAL).copied().unwrap_or(now) };
    let mut tokens = unsafe { BUCKET_TOKENS.get(&KEY_GLOBAL).copied().unwrap_or(burst) };

    if now > last_refill_at {
        let elapsed = now - last_refill_at;
        let refill = elapsed.saturating_mul(refill_per_sec) / NANOS_PER_SEC;
        tokens = core::cmp::min(burst, tokens.saturating_add(refill));
    }

    if tokens == 0 {
        unsafe {
            BUCKET_TOKENS.insert(&KEY_GLOBAL, &0, 0)?;
            BUCKET_REFILL_AT.insert(&KEY_GLOBAL, &now, 0)?;
        }
        return Ok(false);
    }

    let remaining = tokens - 1;
    unsafe {
        BUCKET_TOKENS.insert(&KEY_GLOBAL, &remaining, 0)?;
        BUCKET_REFILL_AT.insert(&KEY_GLOBAL, &now, 0)?;
    }
    Ok(true)
}

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}
