# Build & Push — Tek seferde

Proje kökünde (opsmantik-v1) sırayla:

## 1. Build

```bash
npm run build
```

Başarılı olursa devam et.

## 2. Git status (opsiyonel)

```bash
git status
```

## 3. Stage + Commit + Push

```bash
git add -A
git commit -m "feat: Phase 1-3 Enterprise Modernization — Hardware DNA, Network, Intent Pulse, Returning Giant, HunterCard 4-quadrant + glass"
git push
```

### Commit’e dahil olan başlıca değişikliklar

- **Phase 1.1:** Tracker Hardware DNA (lan, mem, con, sw, sh, dpr, gpu) + sessions/geo/SessionService
- **Phase 1.2:** connection_type (tracker), isp_asn, is_proxy_detected (producer/geo/worker/sessions), url/u fix
- **Phase 2.1:** Intent Pulse (tracker pulse state, conversion/heartbeat meta, EventService on conversion)
- **Phase 2.2:** visitor_rank, previous_visit_count, VETERAN_HUNTER badge (migration + SessionService + HunterCard)
- **Phase 3.1/3.2:** HunterCard ORIGIN Network Type, IDENTITY Language, glass/glow, Verified check animation

---

**Not:** Build’de “Running TypeScript” sırasında EPERM alırsan, komutu IDE dışında (PowerShell/CMD) çalıştırmayı dene. Push için `git push` yetkin olduğundan emin ol.
