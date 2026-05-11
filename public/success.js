// Copy token to clipboard
function copyToken() {
  const token = document.getElementById('accessToken').innerText.trim();
  navigator.clipboard.writeText(token).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = '✅ Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy Token';
      btn.classList.remove('copied');
    }, 2500);
  });
}

// Save to localStorage with 1-hour expiry so homepage can display it
(function () {
  const token  = document.body.dataset.token;
  const expiry = Date.now() + 60 * 60 * 1000;
  localStorage.removeItem('shopify_token'); // always flush old first
  localStorage.setItem('shopify_token', JSON.stringify({
    value:   token,
    expiry:  expiry,
    updated: new Date().toLocaleTimeString()
  }));
})();
