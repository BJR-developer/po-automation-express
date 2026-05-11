// Check localStorage for a valid (non-expired) token and display it
function checkToken() {
  const raw = localStorage.getItem('shopify_token');
  if (!raw) return;

  const data = JSON.parse(raw);
  const now  = Date.now();

  if (now > data.expiry) {
    localStorage.removeItem('shopify_token');
    return;
  }

  const section = document.getElementById('tokenSection');
  section.style.display = 'block';
  document.getElementById('tokenValue').innerText = data.value;

  const minsLeft = Math.ceil((data.expiry - now) / 60000);
  const updated  = data.updated ? ' · Saved at ' + data.updated : '';
  document.getElementById('tokenMeta').innerText = 'Expires in ' + minsLeft + ' mins' + updated;
}

function copyHomeToken() {
  const token = document.getElementById('tokenValue').innerText;
  navigator.clipboard.writeText(token).then(() => {
    const btn = document.getElementById('copyBtnHome');
    btn.innerText = '✅ Copied';
    setTimeout(() => btn.innerText = '📋 Copy', 2000);
  });
}

// Run on page load and every 60s
checkToken();
setInterval(checkToken, 60000);
