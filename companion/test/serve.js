/* dev helper: runs the real core on port 47831 against a temp game folder, writes info to $1 */
const fs = require('fs'), os = require('os'), path = require('path');
const { Config } = require('../src/config'); const { Core } = require('../src/core');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrs-')), sess = path.join(tmp, 'EFT', 'Logs', 'log_2025.10.17_14-00-00_0.16.1.0.1'), shots = path.join(tmp, 'Screenshots');
  fs.mkdirSync(sess, { recursive:true }); fs.mkdirSync(shots);
  fs.writeFileSync(path.join(sess, '2025.10.17 application.log'), ''); fs.writeFileSync(path.join(sess, '2025.10.17 notifications.log'), '');
  fs.writeFileSync(path.join(shots, '2025-10-17[20-01]_-20.5, 1.53, -56.6_0.01508, -0.84564, 0.02792, 0.53288_16.19 (0).png'), 'x');
  const config = new Config(path.join(tmp, 'cfg.json')); config.set('gameDir', path.join(tmp, 'EFT')); config.set('shotsDir', shots);
  const core = new Core({ config, version:'0.1.0', port:47831 }); await core.start();
  setInterval(() => fs.writeFileSync(process.argv[2], JSON.stringify({ code:core.bridge.code, sess, shots })), 300);
})();
