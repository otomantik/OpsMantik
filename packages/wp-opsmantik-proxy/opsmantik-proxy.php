<?php
/**
 * Plugin Name: OpsMantik First-Party Proxy
 * Description: First-party signer/proxy for OpsMantik call-events. Browser sends event to this site; server signs and forwards to OpsMantik Console.
 * Version: 0.1.0
 * Author: OpsMantik
 *
 * Security notes:
 * - Secret never returns to browser.
 * - This proxy is intended to run on the customer's domain (WordPress).
 */

if (!defined('ABSPATH')) { exit; }

define('OPSMANTIK_PROXY_VERSION', '0.1.0');

// Preferred: define in wp-config.php:
// define('OPSMANTIK_PROXY_SECRET', '...random 32+ chars...');
// define('OPSMANTIK_CONSOLE_URL', 'https://console.opsmantik.com');

function opsmantik_get_option_secret() {
  $s = get_option('opsmantik_proxy_secret', '');
  return is_string($s) ? trim($s) : '';
}

function opsmantik_get_secret() {
  if (defined('OPSMANTIK_PROXY_SECRET') && is_string(OPSMANTIK_PROXY_SECRET) && strlen(trim(OPSMANTIK_PROXY_SECRET)) > 0) {
    return trim(OPSMANTIK_PROXY_SECRET);
  }
  return opsmantik_get_option_secret();
}

function opsmantik_get_console_url() {
  if (defined('OPSMANTIK_CONSOLE_URL') && is_string(OPSMANTIK_CONSOLE_URL) && strlen(trim(OPSMANTIK_CONSOLE_URL)) > 0) {
    return rtrim(trim(OPSMANTIK_CONSOLE_URL), '/');
  }
  return 'https://console.opsmantik.com';
}

function opsmantik_best_effort_same_origin() {
  $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
  $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
  if (!$origin || !$host) return true; // best-effort only
  $o = parse_url($origin);
  $oHost = isset($o['host']) ? strtolower($o['host']) : '';
  if (!$oHost) return true;
  return $oHost === strtolower($host);
}

function opsmantik_hmac_sha256_hex($secret, $message) {
  return hash_hmac('sha256', $message, $secret);
}

add_action('rest_api_init', function () {
  register_rest_route('opsmantik/v1', '/call-event', array(
    'methods' => 'POST',
    'permission_callback' => '__return_true',
    'callback' => 'opsmantik_handle_call_event',
  ));
});

function opsmantik_handle_call_event(WP_REST_Request $request) {
  // Best-effort origin guard (do not hard fail; WordPress installs vary).
  if (!opsmantik_best_effort_same_origin()) {
    return new WP_REST_Response(array('error' => 'Forbidden'), 403);
  }

  $secret = opsmantik_get_secret();
  if (!$secret || strlen($secret) < 16) {
    return new WP_REST_Response(array('error' => 'Proxy not configured'), 500);
  }

  $rawBody = $request->get_body();
  if (!is_string($rawBody)) $rawBody = '';
  if (strlen($rawBody) > 65536) {
    return new WP_REST_Response(array('error' => 'Payload too large'), 413);
  }

  $json = json_decode($rawBody, true);
  if (!is_array($json)) {
    return new WP_REST_Response(array('error' => 'Invalid JSON'), 400);
  }

  $siteId = isset($json['site_id']) ? trim(strval($json['site_id'])) : '';
  if (!$siteId) {
    return new WP_REST_Response(array('error' => 'Missing site_id'), 400);
  }

  $ts = time();
  $sig = opsmantik_hmac_sha256_hex($secret, strval($ts) . '.' . $rawBody);

  $console = opsmantik_get_console_url();
  $url = $console . '/api/call-event/v2';

  $resp = wp_remote_post($url, array(
    'timeout' => 4,
    'headers' => array(
      'Content-Type' => 'application/json',
      'X-Ops-Site-Id' => $siteId,
      'X-Ops-Ts' => strval($ts),
      'X-Ops-Signature' => $sig,
      'X-Ops-Proxy' => '1',
      'User-Agent' => 'OpsMantik-WP-Proxy/' . OPSMANTIK_PROXY_VERSION,
    ),
    'body' => $rawBody,
  ));

  if (is_wp_error($resp)) {
    return new WP_REST_Response(array('error' => 'Upstream error'), 502);
  }

  $code = wp_remote_retrieve_response_code($resp);
  $body = wp_remote_retrieve_body($resp);
  $decoded = json_decode($body, true);

  // Pass-through JSON if possible; otherwise wrap.
  if (is_array($decoded)) {
    return new WP_REST_Response($decoded, $code);
  }
  return new WP_REST_Response(array('ok' => ($code >= 200 && $code < 300)), $code);
}

// Minimal settings UI (admin only)
add_action('admin_menu', function () {
  add_options_page('OpsMantik Proxy', 'OpsMantik Proxy', 'manage_options', 'opsmantik-proxy', 'opsmantik_proxy_settings_page');
});

add_action('admin_init', function () {
  register_setting('opsmantik_proxy', 'opsmantik_proxy_secret', array(
    'type' => 'string',
    'sanitize_callback' => function ($v) { return is_string($v) ? trim($v) : ''; },
    'default' => '',
  ));
});

function opsmantik_proxy_settings_page() {
  if (!current_user_can('manage_options')) return;
  ?>
  <div class="wrap">
    <h1>OpsMantik First-Party Proxy</h1>
    <p><strong>Recommended:</strong> define <code>OPSMANTIK_PROXY_SECRET</code> in <code>wp-config.php</code> instead of storing in DB.</p>
    <form method="post" action="options.php">
      <?php settings_fields('opsmantik_proxy'); ?>
      <table class="form-table">
        <tr>
          <th scope="row"><label for="opsmantik_proxy_secret">Proxy Secret</label></th>
          <td>
            <input name="opsmantik_proxy_secret" id="opsmantik_proxy_secret" type="password" value="<?php echo esc_attr(get_option('opsmantik_proxy_secret', '')); ?>" class="regular-text" autocomplete="new-password" />
            <p class="description">Used to sign requests to OpsMantik Console. Keep it private.</p>
          </td>
        </tr>
      </table>
      <?php submit_button(); ?>
    </form>

    <h2>Endpoint</h2>
    <p>Your site endpoint: <code>/wp-json/opsmantik/v1/call-event</code></p>
  </div>
  <?php
}

