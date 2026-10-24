/* Hidden helper window: plays the short two-note "Survived" chime. Nothing is loaded from the internet and nothing is recorded. */
let ctx = null;
window.chime = function(){
  try{
    const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return false;
    ctx = ctx || new AC(); if(ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    [[660, 0], [880, 0.17]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.22, t0 + d + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.42);
      o.connect(g); g.connect(ctx.destination); o.start(t0 + d); o.stop(t0 + d + 0.45);
    });
    return true;
  }catch(e){ return false; }
};
