/* Scientific ESSENCE Editorial Portal
   Browser client uses only the Supabase publishable key.
   All authorization is enforced by PostgreSQL Row Level Security.
*/
const SUPABASE_URL = 'https://ikgcnoekehknvchyjblp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qbf4actPXnlDt2ZNRa4zMQ_iOfVRPsV';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const $ = (id) => document.getElementById(id);
let currentUser = null;
let currentProfile = null;
let visibleManuscripts = [];
const STORAGE_BUCKET = 'scientific-essence-manuscripts';
const MAX_PDF_BYTES = 10 * 1024 * 1024;

$('year').textContent = new Date().getFullYear();

function busy(on) { $('busy-overlay').classList.toggle('hidden', !on); }
function message(text, type = 'success') {
  const el = $('auth-message');
  el.textContent = text;
  el.className = `message ${type}`;
}
function clearMessage() { $('auth-message').className = 'message hidden'; $('auth-message').textContent = ''; }
function safeText(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function labelStatus(status) { return ({under_review:'Under review',revision_requested:'Revision requested',accepted:'Accepted',rejected:'Rejected',submitted:'Submitted',draft:'Draft'})[status] || status; }
function clearLoginFields() {
  $('signin-email').value = '';
  $('signin-password').value = '';
}

function showAuth(tab = 'signin') {
  $('auth-view').classList.remove('hidden');
  $('dashboard-view').classList.add('hidden');
  $('signout-btn').classList.add('hidden');
  switchAuthTab(tab);
}
function switchAuthTab(tab) {
  document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.toggle('active', b.dataset.authTab === tab));
  $('signin-form').classList.toggle('hidden', tab !== 'signin');
  $('signup-form').classList.toggle('hidden', tab !== 'signup');
  clearMessage();
}
function showDashboard() {
  $('auth-view').classList.add('hidden');
  $('dashboard-view').classList.remove('hidden');
  $('signout-btn').classList.remove('hidden');
}

async function loadProfile(user) {
  const { data, error } = await db.from('profiles').select('id, full_name, role').eq('id', user.id).single();
  if (error) throw error;
  return data;
}

function configureRolePanels(role) {
  $('submission-panel').classList.toggle('hidden', role !== 'author');
  $('review-panel').classList.toggle('hidden', role !== 'reviewer');
  $('editor-panel').classList.toggle('hidden', !['admin','editor'].includes(role));
  $('role-pill').textContent = role.toUpperCase();
}

async function enterApp(user) {
  busy(true);
  try {
    currentUser = user;
    currentProfile = await loadProfile(user);
    showDashboard();
    configureRolePanels(currentProfile.role);
    const name = currentProfile.full_name || user.email || 'User';
    $('welcome-title').textContent = `Welcome, ${name.split(' ')[0]}`;
    $('welcome-subtitle').textContent = `You are signed in as ${currentProfile.role}. Your access is controlled by journal permissions.`;
    await refreshData();
  } catch (err) {
    console.error(err);
    showAuth();
    message(`Unable to load your profile: ${err.message}. Contact the journal administrator.`, 'error');
  } finally { busy(false); }
}

async function refreshData() {
  const { data, error } = await db.from('manuscripts').select('id, author_id, title, abstract, keywords, status, submitted_at').order('submitted_at', { ascending: false }).limit(100);
  if (error) throw error;
  visibleManuscripts = data || [];

  if (['admin','editor'].includes(currentProfile.role)) {
    const { data: reviews, error: reviewError } = await db.from('reviews')
      .select('manuscript_id, recommendation, comments, submitted_at')
      .order('submitted_at', { ascending: false });
    if (reviewError) throw reviewError;
    const latestReviewByManuscript = new Map();
    (reviews || []).forEach(review => {
      if (!latestReviewByManuscript.has(review.manuscript_id)) latestReviewByManuscript.set(review.manuscript_id, review);
    });
    visibleManuscripts = visibleManuscripts.map(m => ({
      ...m,
      reviewerReview: latestReviewByManuscript.get(m.id) || null
    }));
  }

  renderManuscripts();
  $('stat-total').textContent = visibleManuscripts.length;
  $('stat-pending').textContent = visibleManuscripts.filter(m => ['submitted','under_review','revision_requested'].includes(m.status)).length;
  $('stat-accepted').textContent = visibleManuscripts.filter(m => m.status === 'accepted').length;
  if (currentProfile.role === 'admin' || currentProfile.role === 'editor') populateEditorSelects();
  if (currentProfile.role === 'reviewer') await populateReviewerSelect();
}

function renderManuscripts() {
  const list = $('manuscript-list');
  if (!visibleManuscripts.length) {
    list.innerHTML = '<div class="empty-state">No manuscripts are visible to this account yet.</div>';
    return;
  }
  list.innerHTML = visibleManuscripts.map(m => {
    let fileAction = '';
    if (currentProfile.role === 'author') {
      fileAction = `<div class="file-actions"><label class="file-label">Upload or add original PDF<input type="file" accept="application/pdf,.pdf" data-upload-kind="original" data-manuscript-id="${safeText(m.id)}"></label></div>`;
    } else if (['admin','editor'].includes(currentProfile.role)) {
      fileAction = `<div class="file-actions"><label class="file-label">Upload anonymized reviewer PDF<input type="file" accept="application/pdf,.pdf" data-upload-kind="blinded" data-manuscript-id="${safeText(m.id)}"></label></div>`;
      const rejected = m.status === 'rejected';
      fileAction += `<div class="file-actions"><button class="button button-secondary" type="button" data-delete-pdfs="original" data-manuscript-id="${safeText(m.id)}" ${rejected ? '' : 'disabled'}>Delete original PDF</button><button class="button button-secondary" type="button" data-delete-pdfs="blinded" data-manuscript-id="${safeText(m.id)}" ${rejected ? '' : 'disabled'}>Delete reviewer PDF</button></div><p class="form-note">${rejected ? 'This manuscript is rejected. You may permanently delete its PDF files. Its abstract and review history will remain.' : 'PDF deletion becomes available after the manuscript status is changed to Rejected.'}</p>`;
    } else if (currentProfile.role === 'reviewer') {
      fileAction = `<div class="file-actions"><button class="button button-secondary" type="button" data-download-blinded="${safeText(m.id)}">Download blinded PDF</button></div>`;
    }
    return `
    <article class="manuscript-item">
      <div class="manuscript-main">
        <h3>${safeText(m.title)}</h3>
        <div class="manuscript-meta">Received ${new Date(m.submitted_at).toLocaleDateString()} · Ref. ${safeText(m.id.slice(0,8).toUpperCase())}</div>
        ${['admin','editor'].includes(currentProfile.role) ? (m.reviewerReview
          ? `<div class="review-summary"><strong>Reviewer recommendation: ${safeText(({accept:'Accept',minor_revision:'Minor revision',major_revision:'Major revision',reject:'Reject'})[m.reviewerReview.recommendation] || m.reviewerReview.recommendation)}</strong><p>${safeText(m.reviewerReview.comments)}</p><small>Review received ${new Date(m.reviewerReview.submitted_at).toLocaleString()}</small></div>`
          : '<div class="review-summary"><strong>Reviewer recommendation: Not submitted yet</strong></div>') : ''}
        <details class="manuscript-details">
          <summary>View abstract</summary>
          <p>${safeText(m.abstract)}</p>
          ${m.keywords && m.keywords.length ? `<p><strong>Keywords:</strong> ${safeText(m.keywords.join(', '))}</p>` : ''}
        </details>
        ${fileAction}
      </div>
      <span class="status ${safeText(m.status)}">${safeText(labelStatus(m.status))}</span>
    </article>`;
  }).join('');
}

function validatePdf(file) {
  if (!file) throw new Error('Select a PDF file first.');
  if (file.size > MAX_PDF_BYTES) throw new Error('The PDF exceeds the 10 MB limit.');
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Only PDF documents are accepted.');
  }
}

async function uploadManuscriptPdf(file, manuscriptId, kind) {
  validatePdf(file);
  const safeName = file.name.replace(/[^a-zA-Z0-9._]/g, '_').slice(-100) || 'manuscript.pdf';
  const folder = kind === 'blinded' ? 'blinded' : 'original';
  const path = `${folder}/${manuscriptId}/${Date.now()}_${safeName}`;
  const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: '0',
    contentType: 'application/pdf',
    upsert: false
  });
  if (error) throw error;
  return path;
}

async function downloadBlindedPdf(manuscriptId) {
  const folder = `blinded/${manuscriptId}`;
  const { data: files, error: listError } = await db.storage.from(STORAGE_BUCKET).list(folder, {
    limit: 100,
    sortBy: { column: 'name', order: 'desc' }
  });
  if (listError) throw listError;
  const pdfs = (files || []).filter(f => f.name && f.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) throw new Error('The editor has not uploaded the anonymized reviewer PDF yet.');
  const { data, error } = await db.storage.from(STORAGE_BUCKET).download(`${folder}/${pdfs[0].name}`);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = pdfs[0].name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function setOptions(select, rows, placeholder) {
  select.innerHTML = `<option value="">${placeholder}</option>` + rows.map(r => `<option value="${safeText(r.id)}">${safeText(r.label || r.title)}</option>`).join('');
}
function manuscriptOptionLabel(m) {
  const date = m.submitted_at ? new Date(m.submitted_at).toLocaleDateString() : '';
  const ref = m.id ? m.id.slice(0,8).toUpperCase() : '';
  return `${m.title}${ref ? ' | Ref. ' + ref : ''}${date ? ' | ' + date : ''}`;
}
function populateEditorSelects() {
  const options = visibleManuscripts.map(m => ({id:m.id,title:m.title,label:manuscriptOptionLabel(m)}));
  setOptions($('status-manuscript'), options, 'Select manuscript');
  setOptions($('assign-manuscript'), options, 'Select manuscript');
}
async function populateReviewerSelect() {
  const { data, error } = await db.from('reviewer_assignments')
    .select('manuscript_id, manuscripts(id,title,submitted_at)')
    .eq('reviewer_id', currentUser.id);
  if (error) throw error;
  const rows = (data || []).map(x => x.manuscripts).filter(Boolean)
    .map(m => ({...m, label:manuscriptOptionLabel(m)}));
  setOptions($('review-manuscript'), rows, 'Select an assignment');
}

for (const tab of document.querySelectorAll('[data-auth-tab]')) tab.addEventListener('click', () => switchAuthTab(tab.dataset.authTab));

$('signin-form').addEventListener('submit', async (event) => {
  event.preventDefault(); clearMessage(); busy(true);
  const email = $('signin-email').value.trim();
  const password = $('signin-password').value;
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  busy(false);
  if (error) return message(error.message, 'error');
  await enterApp(data.user);
});

$('signup-form').addEventListener('submit', async (event) => {
  event.preventDefault(); clearMessage(); busy(true);
  const fullName = $('signup-name').value.trim();
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  const { data, error } = await db.auth.signUp({
    email, password,
    options: { data: { full_name: fullName }, emailRedirectTo: window.location.href.split('#')[0] }
  });
  busy(false);
  if (error) return message(error.message, 'error');
  if (data.session) await enterApp(data.user);
  else message('Account created. Check your email to confirm your address, then return here to sign in.', 'success');
});

$('remove-saved-details-btn').addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  const emailField = $('signin-email');
  const passwordField = $('signin-password');

  emailField.value = '';
  passwordField.value = '';
  emailField.placeholder = 'name@example.com';
  passwordField.placeholder = 'Enter your password';

  emailField.setAttribute('autocomplete', 'off');
  passwordField.setAttribute('autocomplete', 'new-password');
  emailField.setAttribute('readonly', 'readonly');
  passwordField.setAttribute('readonly', 'readonly');

  emailField.blur();
  passwordField.blur();

  window.setTimeout(() => {
    emailField.value = '';
    passwordField.value = '';
  }, 100);

  message('The visible login details have been cleared. Browser saved passwords must be removed separately in Chrome or Edge Password Manager.', 'success');
});

for (const id of ['signin-email', 'signin-password']) {
  $(id).addEventListener('focus', () => {
    $(id).removeAttribute('readonly');
  }, { once: true });
}

$('forgot-btn').addEventListener('click', async () => {
  const email = $('signin-email').value.trim();
  if (!email) return message('Enter your email address first, then select Forgot password.', 'error');
  busy(true);
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split('#')[0] });
  busy(false);
  message(error ? error.message : 'If the account exists, a password recovery email has been sent.', error ? 'error' : 'success');
});

$('signout-btn').addEventListener('click', async () => {
  busy(true);
  const { error } = await db.auth.signOut();
  busy(false);
  if (error) return alert(error.message);
  currentUser = null; currentProfile = null; visibleManuscripts = [];
  clearLoginFields();
  showAuth();
});

$('submission-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = $('manuscript-file').files[0];
  try { validatePdf(file); } catch (err) { return alert(err.message); }
  busy(true);
  const title = $('manuscript-title').value.trim();
  const abstract = $('manuscript-abstract').value.trim();
  const keywords = $('manuscript-keywords').value.split(',').map(x => x.trim()).filter(Boolean).slice(0,15);
  const { data: manuscript, error } = await db.from('manuscripts')
    .insert({ author_id: currentUser.id, title, abstract, keywords, status: 'submitted' })
    .select('id').single();
  if (error) { busy(false); return alert(`Submission could not be saved: ${error.message}`); }
  try {
    await uploadManuscriptPdf(file, manuscript.id, 'original');
    $('submission-form').reset();
    await refreshData();
    alert('Manuscript details and original PDF submitted successfully.');
  } catch (uploadError) {
    alert(`The manuscript record was created, but the PDF upload failed: ${uploadError.message}. Use the original PDF upload control on your manuscript record to retry.`);
    await refreshData();
  } finally { busy(false); }
});

$('status-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('status-manuscript').value;
  const status = $('new-status').value;
  if (!id) return alert('Please select the exact manuscript record, including its reference number.');
  if (!status) return alert('Please select an editorial status.');

  const submitButton = $('status-form').querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Saving decision...';
  busy(true);

  try {
    const { data, error } = await db.from('manuscripts')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id,title,status')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('No manuscript record was updated. Check that you are signed in with the Editor account and that the selected manuscript reference is correct.');

    await refreshData();
    const statusLabel = labelStatus(data.status);
    alert(`Verified: ${data.title} (Ref. ${data.id.slice(0,8).toUpperCase()}) is now marked as ${statusLabel}.`);
  } catch (err) {
    console.error('Editorial status update failed:', err);
    alert(`Editorial status was not confirmed: ${err.message}`);
  } finally {
    busy(false);
    submitButton.disabled = false;
    submitButton.innerHTML = 'Save decision <span>→</span>';
  }
});

$('assign-form').addEventListener('submit', async (event) => {
  event.preventDefault(); busy(true);
  const row = { manuscript_id: $('assign-manuscript').value, reviewer_id: $('reviewer-id').value.trim(), assigned_by: currentUser.id, due_at: $('review-due').value || null };
  const { error } = await db.from('reviewer_assignments').insert(row);
  busy(false);
  if (error) return alert(`Reviewer assignment failed: ${error.message}`);
  $('assign-form').reset(); alert('Reviewer assignment created.');
});

$('review-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const manuscriptId = $('review-manuscript').value;
  const recommendation = $('review-recommendation').value;
  const comments = $('review-comments').value.trim();

  if (!manuscriptId) return alert('Please select your assigned manuscript.');
  if (!recommendation) return alert('Please choose a recommendation.');
  if (comments.length < 20) return alert('Please enter review comments of at least 20 characters.');

  const submitButton = $('review-form').querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Submitting recommendation...';
  busy(true);

  try {
    const row = {
      manuscript_id: manuscriptId,
      reviewer_id: currentUser.id,
      recommendation,
      comments
    };
    const { error } = await db.from('reviews').upsert(row, { onConflict: 'manuscript_id,reviewer_id' });
    if (error) throw error;

    $('review-form').reset();
    alert('Your recommendation and review comments have been saved for editorial consideration. The editor will make the final manuscript decision.');
  } catch (err) {
    console.error('Review submission failed:', err);
    alert(`Review could not be saved: ${err.message}`);
  } finally {
    busy(false);
    submitButton.disabled = false;
    submitButton.innerHTML = 'Submit recommendation <span>→</span>';
  }
});

$('manuscript-list').addEventListener('change', async (event) => {
  const input = event.target.closest('input[data-upload-kind]');
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];
  const manuscriptId = input.dataset.manuscriptId;
  const kind = input.dataset.uploadKind;
  busy(true);
  try {
    await uploadManuscriptPdf(file, manuscriptId, kind);
    alert(kind === 'blinded' ? 'Anonymized reviewer PDF uploaded successfully.' : 'Original manuscript PDF uploaded successfully.');
    input.value = '';
  } catch (err) {
    alert(`PDF upload failed: ${err.message}`);
  } finally { busy(false); }
});

$('manuscript-list').addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('button[data-delete-pdfs]');
  if (deleteButton) {
    const manuscriptId = deleteButton.dataset.manuscriptId;
    const kind = deleteButton.dataset.deletePdfs;
    const label = kind === 'original' ? 'original manuscript PDF' : 'blinded reviewer PDF';
    if (!confirm(`Permanently delete the ${label} for this rejected manuscript? This cannot be undone.`)) return;
    busy(true);
    try {
      const folder = `${kind}/${manuscriptId}`;
      const { data: files, error: listError } = await db.storage.from(STORAGE_BUCKET).list(folder, { limit: 100 });
      if (listError) throw listError;
      const paths = (files || []).filter(f => f.name && f.name.toLowerCase().endsWith('.pdf')).map(f => `${folder}/${f.name}`);
      if (!paths.length) throw new Error('No PDF files were found in this folder.');
      const { error } = await db.storage.from(STORAGE_BUCKET).remove(paths);
      if (error) throw error;
      alert(`${label} deleted successfully. The manuscript record, abstract and review history have been retained.`);
    } catch (err) {
      console.error('PDF deletion failed:', err);
      alert(`PDF deletion failed: ${err.message}`);
    } finally { busy(false); }
    return;
  }

  const button = event.target.closest('button[data-download-blinded]');
  if (!button) return;
  busy(true);
  try { await downloadBlindedPdf(button.dataset.downloadBlinded); }
  catch (err) { alert(err.message); }
  finally { busy(false); }
});

$('refresh-btn').addEventListener('click', async () => {
  busy(true);
  try { await refreshData(); } catch (err) { alert(err.message); }
  finally { busy(false); }
});

// Password recovery links return to this page with a recovery session.
db.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    const newPassword = prompt('Enter a new password with at least 10 characters:');
    if (newPassword && newPassword.length >= 10) {
      const { error } = await db.auth.updateUser({ password: newPassword });
      alert(error ? error.message : 'Password updated. Please sign in again.');
      await db.auth.signOut(); showAuth();
    } else if (newPassword !== null) alert('Password must contain at least 10 characters.');
  }
  if (event === 'SIGNED_OUT') showAuth();
});

(async function init() {
  busy(true);
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) await enterApp(session.user);
  else showAuth();
  busy(false);
})();
