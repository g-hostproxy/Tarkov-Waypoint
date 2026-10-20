/* dev helper: runs the real Core on the real port and writes { code, embedded } to the file given */
const fs = require('fs'), os = require('os'), path = require('path');
const { Config } = require('../src/config'); const { Core } = require('../src/core');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrs-')); const config = new Config(path.join(tmp, 'cfg.json'));
  config.set('gameDir', path.join(tmp, 'none')); config.set('shotsDir', path.join(tmp, 'none2'));
  const core = new Core({ config, version:'dev' }); await core.start();
  const out = () => fs.writeFileSync(process.argv[2], JSON.stringify({ code:core.bridge.code, embedded:config.embedded(), prefs:core.prefs(), set:!!config.get('prefsSet') }));
  out(); setInterval(out, 300);
})();
