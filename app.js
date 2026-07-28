(function () {
  function pass(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.add('ok');
  }

  // style.css is the only source of the card's border radius, so a non-zero
  // value means the stylesheet actually resolved over Pages.
  var radius = getComputedStyle(document.querySelector('.card')).borderRadius;
  if (radius && parseFloat(radius) > 0) {
    pass('check-css', 'loaded');
  } else {
    document.getElementById('check-css').textContent = 'not loaded';
  }

  pass('check-js', 'loaded');

  document.getElementById('rendered-at').textContent = new Date().toISOString();
  document.getElementById('origin').textContent = window.location.origin + window.location.pathname;
})();
