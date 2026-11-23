const $ = (id) => document.getElementById(id);
async function refresh() {
  const { st = {}, logs = [] } = await chrome.storage.local.get(['st', 'logs']);
  const q = await chrome.runtime.sendMessage({ type: 'queue' });
  $('status').textContent = `${st.running ? 'RUNNING' : 'Stopped'} · queue: ${q.ok ? q.jobs.length : q.error} · today: ${st.count || 0}` +
    (st.current ? ` · now: ${st.current.job.company}` : '');
  $('log').textContent = logs.join('\n');
  $('log').scrollTop = 1e6;
}
$('start').onclick = async () => { await chrome.runtime.sendMessage({ type: 'start' }); refresh(); };
$('stop').onclick = async () => { await chrome.runtime.sendMessage({ type: 'stop' }); refresh(); };
$('opts').onclick = () => chrome.runtime.openOptionsPage();
refresh(); setInterval(refresh, 3000);
