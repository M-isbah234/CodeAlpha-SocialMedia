/* ============================================================
   Orbit — frontend logic (vanilla ES6+).
   Single-page app talking to the Django REST API.
   ============================================================ */

const API_BASE = 'http://127.0.0.1:8000/api';

const state = {
  token: sessionStorage.getItem('orbit_token') || null,
  user: null, // { id, username, avatar }
};

/* --------------------------- DOM helpers -------------------------- */
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function parseTags(text) {
  let html = escapeHtml(text || '');
  html = html.replace(/#(\w+)/g, '<span class="hashtag" data-tag="$1">#$1</span>');
  html = html.replace(/@(\w+)/g, '<span class="mention" data-user="$1">@$1</span>');
  return html;
}

function timeAgo(iso) {
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString();
}

function clockTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const AVATAR_COLORS = ['#0C6262', '#F5B942', '#E5684B', '#2A9D8F', '#3A86C8', '#8E5AA8', '#E76F9E', '#5AAE68'];
function colorFor(name = '?') {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Paint an avatar element with an image, or coloured initials fallback. */
function fillAvatar(el, user) {
  const name = user?.username || '?';
  el.innerHTML = '';
  if (user?.avatar) {
    const img = document.createElement('img');
    img.src = user.avatar;
    img.alt = name;
    el.appendChild(img);
    el.style.background = 'transparent';
  } else {
    el.textContent = name.charAt(0).toUpperCase();
    el.style.background = colorFor(name);
  }
}

let toastTimer;
function toast(message, isError = false) {
  const t = qs('#toast');
  t.textContent = message;
  t.className = 'toast' + (isError ? ' toast--error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ------------------------- API wrapper ---------------------------- */
async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (auth && state.token) headers['Authorization'] = `Token ${state.token}`;

  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = data.detail || Object.values(data)[0] || 'Something went wrong';
    throw new Error(Array.isArray(first) ? first[0] : first);
  }
  return data;
}

/* --------------------------- View routing ------------------------- */
const NAV_FOR = {
  'search-view': 'search',
  'feed-view': 'feed',
  'profile-view': 'profile',
  'messages-view': 'messages',
  'bookmarks-view': 'bookmarks',
};

function showView(id, navKey = NAV_FOR[id] || id) {
  qsa('.view').forEach((v) => { v.hidden = v.id !== id; });
  qsa('.bottom-nav__item').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.nav === navKey);
  });
  window.scrollTo({ top: 0 });
}

/* ------------------------- Auth / bootstrap ----------------------- */
async function bootstrap() {
  if (state.token) {
    try {
      const me = await apiFetch('/auth/me/');
      state.user = { id: me.user_id, username: me.username, avatar: me.avatar };
      enterApp(me);
      return;
    } catch {
      state.token = null;
      sessionStorage.removeItem('orbit_token');
    }
  }
  showChrome(false);
  showView('auth-view', null);
}

function showChrome(on) {
  qs('#topbar').hidden = !on;
  qs('#bottom-nav').hidden = !on;
}

function enterApp(me = null) {
  showChrome(true);
  fillAvatar(qs('#composer-avatar'), state.user);
  // My Profile is the default home. Reuse the /auth/me/ payload if we have it.
  if (me) { renderProfile(me); showView('profile-view'); }
  else openMyProfile();
  refreshUnreadBadge();
  refreshNotifBadge();
  startNotifPoll();
}

async function handleAuth(kind, form) {
  const body = Object.fromEntries(new FormData(form).entries());
  const path = kind === 'login' ? '/auth/login/' : '/auth/register/';
  const data = await apiFetch(path, { method: 'POST', body, auth: false });
  state.token = data.token;
  sessionStorage.setItem('orbit_token', state.token);
  state.user = { id: data.user.id, username: data.user.username, avatar: data.user.avatar };
  // Clear both auth forms so nothing lingers behind the app.
  qs('#login-form').reset();
  qs('#signup-form').reset();
  qs('#auth-error').textContent = '';
  enterApp();
}

async function logout() {
  stopChatPoll();
  stopNotifPoll();
  try { await apiFetch('/auth/logout/', { method: 'POST' }); } catch { /* token already gone */ }
  state.token = null;
  state.user = null;
  sessionStorage.removeItem('orbit_token');
  showChrome(false);
  swapAuthForm('login');
  showView('auth-view', null);
}

function swapAuthForm(which) {
  qs('#login-form').hidden = which !== 'login';
  qs('#signup-form').hidden = which !== 'signup';
  qs('#auth-error').textContent = '';
}

/* ------------------------------ Feed ------------------------------ */
async function loadFeed(hashtag = '') {
  showView('feed-view', 'feed');
  const feed = qs('#feed');
  feed.innerHTML = '<p class="empty">Loading…</p>';
  if (hashtag) {
    qs('#feed-title').textContent = `#${hashtag}`;
  } else {
    qs('#feed-title').textContent = 'Feed';
  }
  try {
    const url = hashtag ? `/posts/?hashtag=${encodeURIComponent(hashtag)}` : '/posts/?feed=true';
    const posts = await apiFetch(url);
    renderFeed(feed, posts, hashtag ? `No posts found for #${hashtag}.` : 'No posts from others yet. Find people in Search!');
  } catch (e) {
    feed.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
  }
}

function renderFeed(container, posts, emptyMsg = 'Nothing here yet.') {
  container.innerHTML = '';
  if (!posts.length) {
    container.innerHTML = `<p class="empty">${escapeHtml(emptyMsg)}</p>`;
    return;
  }
  posts.forEach((p) => container.appendChild(renderPost(p)));
}

function renderPost(post) {
  const node = qs('#post-template').content.firstElementChild.cloneNode(true);
  node.dataset.postId = post.id;

  fillAvatar(qs('.post__avatar', node), post.author);
  qs('.post__author-name', node).textContent = post.author.username;
  qs('.post__author', node).dataset.username = post.author.username;
  qs('.post__time', node).textContent = timeAgo(post.created_at);
  qs('.post__time', node).title = new Date(post.created_at).toLocaleString();
  qs('.post__content', node).innerHTML = parseTags(post.content);

  const img = qs('.post__image', node);
  if (post.image) { img.src = post.image; img.hidden = false; }

  qs('.like-count', node).textContent = post.like_count;
  qs('.comment-count', node).textContent = post.comment_count;

  const likeBtn = qs('.like-btn', node);
  likeBtn.classList.toggle('is-liked', post.liked);
  qs('.like-icon', node).textContent = post.liked ? '♥' : '♡';

  const bookmarkBtn = qs('.bookmark-btn', node);
  if (bookmarkBtn) {
    bookmarkBtn.classList.toggle('is-bookmarked', post.is_bookmarked);
  }

  if (state.user && post.author.id === state.user.id) {
    qs('.post__delete', node).hidden = false;
  }
  return node;
}

/* --------------------- Composer / create post --------------------- */
function clearComposer() {
  const form = qs('#post-form');
  form.reset();
  qs('#post-count').textContent = '0 / 1000';
  const preview = qs('#image-preview');
  const img = qs('img', preview);
  if (img.src) URL.revokeObjectURL(img.src);
  img.removeAttribute('src');
  preview.hidden = true;
}

async function createPost(form) {
  const content = form.content.value.trim();
  const file = qs('#image-input').files[0];
  if (!content && !file) { toast('Write something or attach an image.', true); return; }

  const fd = new FormData();
  if (content) fd.append('content', content);
  if (file) fd.append('image', file);

  const post = await apiFetch('/posts/', { method: 'POST', body: fd });
  clearComposer();

  // New post belongs on your profile — prepend it there and bump the count.
  const feed = qs('#profile-feed');
  const empty = qs('.empty', feed);
  if (empty) empty.remove();
  feed.prepend(renderPost(post));
  const stat = qs('#stat-posts');
  stat.textContent = Number(stat.textContent) + 1;
}

/* ------------------- Likes / delete / comments -------------------- */
async function toggleLike(btn) {
  const article = btn.closest('.post');
  const id = article.dataset.postId;
  btn.disabled = true;
  try {
    const data = await apiFetch(`/posts/${id}/like/`, { method: 'POST' });
    btn.classList.toggle('is-liked', data.liked);
    qs('.like-icon', btn).textContent = data.liked ? '♥' : '♡';
    qs('.like-count', btn).textContent = data.like_count;
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function toggleBookmark(btn) {
  const article = btn.closest('.post');
  const id = article.dataset.postId;
  btn.disabled = true;
  try {
    const data = await apiFetch(`/posts/${id}/bookmark/`, { method: 'POST' });
    btn.classList.toggle('is-bookmarked', data.bookmarked);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function deletePost(btn) {
  if (!confirm('Delete this post? This cannot be undone.')) return;
  const article = btn.closest('.post');
  try {
    await apiFetch(`/posts/${article.dataset.postId}/`, { method: 'DELETE' });
    article.remove();
    // If it was on our own profile, keep the counter honest.
    if (!qs('#profile-view').hidden) {
      const stat = qs('#stat-posts');
      stat.textContent = Math.max(0, Number(stat.textContent) - 1);
    }
    toast('Post deleted');
  } catch (e) {
    toast(e.message, true);
  }
}

async function toggleComments(btn) {
  const article = btn.closest('.post');
  const section = qs('.comments', article);
  const willShow = section.hidden;
  section.hidden = !willShow;
  if (willShow && !section.dataset.loaded) {
    await loadComments(article);
    section.dataset.loaded = '1';
  }
}

async function loadComments(article) {
  const list = qs('.comment-list', article);
  list.innerHTML = '<li class="muted">Loading…</li>';
  try {
    const comments = await apiFetch(`/posts/${article.dataset.postId}/comments/`);
    list.innerHTML = '';
    comments.forEach((c) => list.appendChild(renderComment(c)));
  } catch (e) {
    list.innerHTML = `<li class="muted">${escapeHtml(e.message)}</li>`;
  }
}

function renderComment(c) {
  const li = document.createElement('li');
  li.className = 'comment';

  const avatar = document.createElement('span');
  avatar.className = 'avatar avatar--sm';
  fillAvatar(avatar, c.author);

  const bubble = document.createElement('div');
  bubble.className = 'comment__bubble';
  const author = document.createElement('span');
  author.className = 'comment__author';
  author.textContent = c.author.username;
  author.dataset.username = c.author.username;
  author.style.cursor = 'pointer';
  const text = document.createElement('div');
  text.className = 'comment__text';
  text.innerHTML = parseTags(c.content);
  bubble.append(author, text);

  li.append(avatar, bubble);
  return li;
}

async function addComment(form) {
  const article = form.closest('.post');
  const input = qs('.comment-input', form);
  const content = input.value.trim();
  if (!content) return;
  try {
    const comment = await apiFetch(`/posts/${article.dataset.postId}/comments/`, {
      method: 'POST',
      body: { content },
    });
    qs('.comment-list', article).appendChild(renderComment(comment));
    input.value = '';
    const counter = qs('.comment-count', article);
    counter.textContent = Number(counter.textContent) + 1;
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------------------- Profile ----------------------------- */
async function openMyProfile() {
  showView('profile-view');
  const feed = qs('#profile-feed');
  feed.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const me = await apiFetch('/auth/me/');
    state.user = { id: me.user_id, username: me.username, avatar: me.avatar };
    renderProfile(me);
  } catch (e) {
    feed.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
  }
}

async function openPublicProfile(username) {
  if (state.user && username === state.user.username) return openMyProfile();
  showView('profile-view', null);
  const feed = qs('#profile-feed');
  feed.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const profile = await apiFetch(`/users/${encodeURIComponent(username)}/`);
    renderProfile(profile);
  } catch (e) {
    feed.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
  }
}

function renderProfile(p) {
  fillAvatar(qs('#profile-avatar'), { username: p.username, avatar: p.avatar });
  qs('#profile-username').textContent = p.username;
  qs('#profile-bio').textContent = p.bio || 'No bio yet.';
  qs('#stat-posts').textContent = p.post_count;
  qs('#stat-followers').textContent = p.follower_count;
  qs('#stat-following').textContent = p.following_count;

  const followBtn = qs('#follow-btn');
  const messageBtn = qs('#message-btn');
  const editBtn = qs('#edit-profile-btn');
  const editForm = qs('#edit-profile-form');
  const composer = qs('#composer');
  editForm.hidden = true;

  const isMe = state.user && p.user_id === state.user.id;
  followBtn.hidden = isMe;
  messageBtn.hidden = isMe;
  editBtn.hidden = !isMe;
  composer.hidden = !isMe;

  if (isMe) {
    editForm.querySelector('[name=bio]').value = p.bio || '';
    fillAvatar(qs('#composer-avatar'), state.user);
  } else {
    followBtn.dataset.userId = p.user_id;
    setFollowBtn(followBtn, p.is_following);
    messageBtn.dataset.userId = p.user_id;
    messageBtn.dataset.username = p.username;
    messageBtn.dataset.avatar = p.avatar || '';
  }

  // Profiles carry their own posts (ProfileDetailSerializer).
  renderFeed(qs('#profile-feed'), p.posts || [],
    isMe ? 'You haven’t posted yet — say hi above!' : 'No posts yet.');
}

async function loadSavedPosts() {
  showView('bookmarks-view');
  const feed = qs('#bookmarks-feed');
  feed.innerHTML = '<p class="empty">Loading saved posts…</p>';
  try {
    const posts = await apiFetch('/posts/bookmarks/');
    renderFeed(feed, posts, 'You haven’t saved any posts yet.');
  } catch (e) {
    feed.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
  }
}

function setFollowBtn(btn, following) {
  btn.textContent = following ? 'Following' : 'Follow';
  btn.classList.toggle('btn--soft', following);
  btn.classList.toggle('btn--accent', !following);
}

async function toggleFollowProfile() {
  const btn = qs('#follow-btn');
  btn.disabled = true;
  try {
    const data = await apiFetch(`/users/${btn.dataset.userId}/follow/`, { method: 'POST' });
    setFollowBtn(btn, data.following);
    qs('#stat-followers').textContent = data.follower_count;
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function saveProfile(form) {
  const fd = new FormData(form);
  const file = fd.get('avatar');
  if (file && !file.name) fd.delete('avatar'); // no new file chosen
  try {
    const p = await apiFetch('/auth/me/', { method: 'PATCH', body: fd });
    state.user.avatar = p.avatar;
    fillAvatar(qs('#composer-avatar'), state.user);
    renderProfile(p);
    toast('Profile updated');
  } catch (e) {
    toast(e.message, true);
  }
}

/* ----------------------------- Search ----------------------------- */
let searchTimer;
async function runSearch(query) {
  const box = qs('#search-results');
  const q = query.trim();
  if (!q) { box.innerHTML = '<p class="empty">Type a username to find people.</p>'; return; }
  try {
    const users = await apiFetch(`/users/search/?q=${encodeURIComponent(q)}`);
    if (!users.length) { box.innerHTML = '<p class="empty">No users matched.</p>'; return; }
    box.innerHTML = '';
    users.forEach((u) => box.appendChild(renderUserCard(u)));
  } catch (e) {
    box.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
  }
}

function renderUserCard(u) {
  const node = qs('#user-card-template').content.firstElementChild.cloneNode(true);
  node.dataset.userId = u.user_id;
  node.dataset.username = u.username;
  fillAvatar(qs('.user-card__avatar', node), { username: u.username, avatar: u.avatar });
  qs('.user-card__name', node).textContent = u.username;
  qs('.user-card__sub', node).textContent =
    `${u.follower_count} follower${u.follower_count === 1 ? '' : 's'}`;
  const btn = qs('.follow-toggle', node);
  setFollowBtn(btn, u.is_following);
  return node;
}

async function toggleFollowUser(userId, btn) {
  btn.disabled = true;
  try {
    const data = await apiFetch(`/users/${userId}/follow/`, { method: 'POST' });
    setFollowBtn(btn, data.following);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

/* --------------------------- Messages ----------------------------- */
let chatPoll = null;
let currentPeer = null;        // { id, username, avatar }
let chatSeen = new Set();

async function loadConversations() {
  showView('messages-view');
  qs('#chat-panel').hidden = true;
  qs('#inbox').hidden = false;
  const list = qs('#conversation-list');
  list.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const convos = await apiFetch('/messages/');
    updateBadge(convos.reduce((n, c) => n + c.unread, 0));
    if (!convos.length) {
      list.innerHTML = '<p class="empty">No conversations yet. Open someone’s profile and say hi!</p>';
      return;
    }
    list.innerHTML = '';
    convos.forEach((c) => list.appendChild(renderConversation(c)));
  } catch (e) {
    list.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
  }
}

function renderConversation(c) {
  const node = qs('#conversation-template').content.firstElementChild.cloneNode(true);
  node.dataset.userId = c.user.id;
  node.dataset.username = c.user.username;
  node.dataset.avatar = c.user.avatar || '';
  fillAvatar(qs('.user-card__avatar', node), c.user);
  qs('.user-card__name', node).textContent = c.user.username;
  qs('.conversation__preview', node).textContent = c.last_message;
  if (c.unread > 0) {
    const badge = qs('.conversation__badge', node);
    badge.textContent = c.unread;
    badge.hidden = false;
  }
  return node;
}

function openChat(peer) {
  currentPeer = peer;
  chatSeen = new Set();
  showView('messages-view');       // ensure the Messages view is visible (e.g. from a profile)
  qs('#inbox').hidden = true;
  const panel = qs('#chat-panel');
  panel.hidden = false;
  fillAvatar(qs('#chat-peer-avatar'), peer);
  qs('#chat-peer-name').textContent = peer.username;
  qs('#chat-peer').dataset.username = peer.username;
  qs('#chat-scroll').innerHTML = '';
  qs('#chat-input').value = '';
  // First load also refreshes the badge (the server marks these read).
  fetchConversation().then(refreshUnreadBadge);
  startChatPoll();
}

async function fetchConversation() {
  if (!currentPeer) return;
  try {
    const url = currentPeer.is_group ? `/groups/${currentPeer.id}/` : `/messages/${currentPeer.id}/`;
    const data = await apiFetch(url);
    paintMessages(data.messages);
  } catch (e) {
    toast(e.message, true);
  }
}

function paintMessages(messages) {
  const scroll = qs('#chat-scroll');
  let added = false;
  messages.forEach((m) => {
    if (chatSeen.has(m.id)) return;
    chatSeen.add(m.id);
    scroll.appendChild(renderBubble(m));
    added = true;
  });
  if (added) scroll.scrollTop = scroll.scrollHeight;
}

function renderBubble(m) {
  const div = document.createElement('div');
  div.className = 'bubble ' + (m.is_mine ? 'bubble--out' : 'bubble--in');
  
  if (currentPeer.is_group && !m.is_mine) {
    const sender = document.createElement('div');
    sender.className = 'bubble__sender';
    sender.textContent = m.sender.username;
    sender.style.fontSize = '0.75rem';
    sender.style.opacity = '0.7';
    sender.style.marginBottom = '2px';
    div.append(sender);
  }

  const text = document.createElement('span');
  text.textContent = m.content;
  
  const time = document.createElement('span');
  time.className = 'bubble__time';
  time.textContent = clockTime(m.timestamp);
  
  div.append(text);
  
  if (m.shared_post) {
    const sp = document.createElement('div');
    sp.className = 'bubble__shared-post';
    sp.style.border = '1px solid var(--border)';
    sp.style.padding = '8px';
    sp.style.borderRadius = 'var(--radius-sm)';
    sp.style.marginTop = '4px';
    sp.style.background = 'var(--surface-2)';
    sp.innerHTML = `<strong>@${escapeHtml(m.shared_post.author.username)}</strong><br>${escapeHtml(m.shared_post.content || '[Image]')}`;
    div.append(sp);
  }
  
  div.append(time);
  return div;
}

async function sendMessage(form, shared_post_id = null) {
  const input = qs('#chat-input');
  const content = input ? input.value.trim() : '';
  if ((!content && !shared_post_id) || !currentPeer) return;
  if (input) input.value = '';
  try {
    const url = currentPeer.is_group ? `/groups/${currentPeer.id}/send/` : '/messages/send/';
    const body = currentPeer.is_group ? { content, shared_post_id } : { recipient: currentPeer.id, content, shared_post_id };
    
    const msg = await apiFetch(url, {
      method: 'POST',
      body,
    });
    paintMessages([msg]);
  } catch (e) {
    if (input) input.value = content; // let them retry
    toast(e.message, true);
  }
}

function startChatPoll() {
  stopChatPoll();
  chatPoll = setInterval(fetchConversation, 3500);
}
function stopChatPoll() {
  if (chatPoll) { clearInterval(chatPoll); chatPoll = null; }
}

function updateBadge(count) {
  const badge = qs('#messages-badge');
  if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.hidden = false; }
  else badge.hidden = true;
}

async function refreshUnreadBadge() {
  try {
    const convos = await apiFetch('/messages/');
    updateBadge(convos.reduce((n, c) => n + c.unread, 0));
  } catch { /* non-critical */ }
}

async function loadGroups() {
  const list = qs('#groups-feed');
  list.innerHTML = '<p class="empty">Loading groups…</p>';
  try {
    const groups = await apiFetch('/groups/');
    if (!groups.length) {
      list.innerHTML = '<p class="empty">No groups yet.</p>';
      return;
    }
    list.innerHTML = '';
    groups.forEach((g) => list.appendChild(renderGroup(g)));
  } catch (e) {
    list.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
  }
}

function renderGroup(g) {
  const node = qs('#conversation-template').content.firstElementChild.cloneNode(true);
  node.dataset.groupId = g.id;
  node.dataset.name = g.name;
  node.dataset.isGroup = '1';
  fillAvatar(qs('.user-card__avatar', node), { username: g.name, avatar: g.image });
  qs('.user-card__name', node).textContent = g.name;
  qs('.conversation__preview', node).textContent = g.last_message;
  return node;
}

let notifPoll = null;
async function refreshNotifBadge() {
  try {
    const notifs = await apiFetch('/notifications/');
    const unread = notifs.filter(n => !n.is_read).length;
    const badge = qs('#notifications-badge');
    if (unread > 0) { badge.textContent = unread > 99 ? '99+' : unread; badge.hidden = false; }
    else badge.hidden = true;
  } catch { /* non-critical */ }
}
function startNotifPoll() {
  stopNotifPoll();
  notifPoll = setInterval(refreshNotifBadge, 10000);
}
function stopNotifPoll() {
  if (notifPoll) { clearInterval(notifPoll); notifPoll = null; }
}

async function loadNotifications() {
  const dropdown = qs('#notifications-dropdown');
  const willShow = dropdown.hidden;
  dropdown.hidden = !willShow;
  if (!willShow) return;

  const list = qs('#notification-list');
  list.innerHTML = '<li class="empty" style="padding:12px; text-align:center; color:var(--muted);">Loading…</li>';
  try {
    const notifs = await apiFetch('/notifications/');
    if (!notifs.length) {
      list.innerHTML = '<li class="empty" style="padding:12px; text-align:center; color:var(--muted);">No notifications yet.</li>';
      return;
    }
    list.innerHTML = '';
    notifs.forEach(n => list.appendChild(renderNotification(n)));
    refreshNotifBadge();
  } catch (e) {
    list.innerHTML = `<li class="empty" style="padding:12px; text-align:center; color:var(--muted);">${escapeHtml(e.message)}</li>`;
  }
}

function renderNotification(n) {
  const li = document.createElement('li');
  li.className = 'notification' + (n.is_read ? '' : ' notification--unread');
  
  const avatar = document.createElement('span');
  avatar.className = 'avatar avatar--sm';
  fillAvatar(avatar, n.actor);
  
  const text = document.createElement('div');
  text.className = 'notification__text';
  text.innerHTML = `<strong>${escapeHtml(n.actor.username)}</strong> ${escapeHtml(n.verb)}`;
  
  const time = document.createElement('div');
  time.className = 'notification__time';
  time.textContent = timeAgo(n.created_at);
  
  li.append(avatar, text, time);
  
  li.addEventListener('click', async () => {
    if (!n.is_read) {
      li.classList.remove('notification--unread');
      apiFetch(`/notifications/${n.id}/read/`, { method: 'POST' }).then(refreshNotifBadge).catch(()=>{});
    }
    qs('#notifications-dropdown').hidden = true;
    openPublicProfile(n.actor.username);
  });
  return li;
}

/* ----------------------- Event delegation ------------------------- */
function onContainerClick(e) {
  const likeBtn = e.target.closest('.like-btn');
  if (likeBtn) return toggleLike(likeBtn);

  const bookmarkBtn = e.target.closest('.bookmark-btn');
  if (bookmarkBtn) return toggleBookmark(bookmarkBtn);

  const commentToggle = e.target.closest('.comment-toggle');
  if (commentToggle) return toggleComments(commentToggle);

  const del = e.target.closest('.post__delete');
  if (del) return deletePost(del);

  const author = e.target.closest('.post__author');
  if (author) return openPublicProfile(author.dataset.username);

  const commentAuthor = e.target.closest('.comment__author');
  if (commentAuthor) return openPublicProfile(commentAuthor.dataset.username);

  // Search result: follow toggle vs open profile
  const followToggle = e.target.closest('.follow-toggle');
  if (followToggle) {
    const card = followToggle.closest('.user-card');
    return toggleFollowUser(card.dataset.userId, followToggle);
  }
  const cardMain = e.target.closest('.user-card__main');
  if (cardMain) return openPublicProfile(cardMain.closest('.user-card').dataset.username);

  const hashtag = e.target.closest('.hashtag');
  if (hashtag) return loadFeed(hashtag.dataset.tag);

  const mention = e.target.closest('.mention');
  if (mention) return openPublicProfile(mention.dataset.user);
  
  const shareBtn = e.target.closest('.share-btn');
  if (shareBtn) return openShareModal(shareBtn.closest('.post').dataset.postId);

  // Conversation row → open chat
  const convo = e.target.closest('.conversation');
  if (convo) {
    if (convo.dataset.isGroup === '1') {
      return openChat({
        id: Number(convo.dataset.groupId),
        username: convo.dataset.name,
        avatar: null,
        is_group: true
      });
    } else {
      return openChat({
        id: Number(convo.dataset.userId),
        username: convo.dataset.username,
        avatar: convo.dataset.avatar || null,
        is_group: false
      });
    }
  }
}

let postToShare = null;
async function openShareModal(postId) {
  postToShare = postId;
  const modal = qs('#share-modal');
  const targets = qs('#share-targets');
  targets.innerHTML = '<p class="empty">Loading...</p>';
  modal.showModal();
  
  try {
    const convos = await apiFetch('/messages/');
    const groups = await apiFetch('/groups/');
    
    targets.innerHTML = '';
    
    if (!convos.length && !groups.length) {
      targets.innerHTML = '<p class="empty">No active conversations or groups.</p>';
      return;
    }
    
    // Render groups
    groups.forEach(g => {
      const btn = document.createElement('button');
      btn.className = 'btn btn--soft';
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.style.marginBottom = '8px';
      btn.textContent = `Send to Group: ${g.name}`;
      btn.onclick = async () => {
        btn.disabled = true;
        currentPeer = { id: g.id, is_group: true };
        await sendMessage(null, postToShare);
        modal.close();
        toast('Post shared to group!');
      };
      targets.appendChild(btn);
    });
    
    // Render Direct Messages
    convos.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'btn btn--soft';
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.style.marginBottom = '8px';
      btn.textContent = `Send to: ${c.user.username}`;
      btn.onclick = async () => {
        btn.disabled = true;
        currentPeer = { id: c.user.id, is_group: false };
        await sendMessage(null, postToShare);
        modal.close();
        toast('Post shared!');
      };
      targets.appendChild(btn);
    });
    
  } catch (e) {
    targets.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
  }
}

function onContainerSubmit(e) {
  if (e.target.classList.contains('comment-form')) {
    e.preventDefault();
    addComment(e.target);
  }
}

/* ------------------------------ Init ------------------------------ */
function init() {
  // Auth form switching (login <-> signup, never both visible)
  qs('#show-signup').addEventListener('click', () => swapAuthForm('signup'));
  qs('#show-login').addEventListener('click', () => swapAuthForm('login'));

  qs('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await handleAuth('login', e.target); }
    catch (err) { qs('#auth-error').textContent = err.message; }
  });
  qs('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await handleAuth('signup', e.target); }
    catch (err) { qs('#auth-error').textContent = err.message; }
  });

  qs('#logout-btn').addEventListener('click', logout);

  // Theme toggle
  const isDark = localStorage.getItem('orbit_dark') === '1';
  const themeBtn = qs('#theme-toggle');
  if (isDark) {
    document.body.classList.add('dark');
    themeBtn.textContent = '☀️';
  }
  themeBtn.addEventListener('click', () => {
    const willBeDark = !document.body.classList.contains('dark');
    document.body.classList.toggle('dark', willBeDark);
    themeBtn.textContent = willBeDark ? '☀️' : '🌙';
    localStorage.setItem('orbit_dark', willBeDark ? '1' : '0');
  });

  // Notifications toggle
  qs('#notifications-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    loadNotifications();
  });
  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#notifications-dropdown') && !e.target.closest('#notifications-btn')) {
      qs('#notifications-dropdown').hidden = true;
    }
  });

  // Bottom navigation
  qsa('[data-nav]').forEach((el) => el.addEventListener('click', () => {
    stopChatPoll();
    switch (el.dataset.nav) {
      case 'search': showView('search-view'); qs('#search-input').focus(); break;
      case 'feed': loadFeed(); break;
      case 'profile': openMyProfile(); break;
      case 'messages': loadConversations(); break;
      case 'bookmarks': loadSavedPosts(); break;
    }
  }));

  // Profile tabs
  qs('#tab-direct').addEventListener('click', () => {
    qs('#tab-direct').classList.add('is-active');
    qs('#tab-groups').classList.remove('is-active');
    qs('#conversation-list').hidden = false;
    qs('#group-list').hidden = true;
  });
  qs('#tab-groups').addEventListener('click', () => {
    qs('#tab-groups').classList.add('is-active');
    qs('#tab-direct').classList.remove('is-active');
    qs('#conversation-list').hidden = true;
    qs('#group-list').hidden = false;
    loadGroups();
  });
  
  qs('#create-group-btn').addEventListener('click', async () => {
    qs('#create-group-modal').showModal();
    const membersList = qs('#group-members-list');
    membersList.innerHTML = '<p class="empty" style="margin:0;">Loading following...</p>';
    
    try {
      const following = await apiFetch('/users/following/');
      if (!following.length) {
        membersList.innerHTML = '<p class="empty" style="margin:0;">You are not following anyone yet.</p>';
        return;
      }
      
      membersList.innerHTML = '';
      following.forEach(f => {
        const lbl = document.createElement('label');
        lbl.style.display = 'flex';
        lbl.style.alignItems = 'center';
        lbl.style.gap = '8px';
        lbl.style.padding = '4px 0';
        lbl.style.cursor = 'pointer';
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.name = 'members';
        chk.value = f.user_id;
        
        const name = document.createElement('span');
        name.textContent = f.username;
        
        lbl.appendChild(chk);
        lbl.appendChild(name);
        membersList.appendChild(lbl);
      });
    } catch (e) {
      membersList.innerHTML = `<p class="empty" style="margin:0; color:var(--danger);">${escapeHtml(e.message)}</p>`;
    }
  });
  qs('#create-group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('button[type="submit"]', e.target);
    btn.disabled = true;
    const fd = new FormData(e.target);
    // fd.getAll('members') handles checkboxes naturally
    try {
      const g = await apiFetch('/groups/', { method: 'POST', body: fd });
      e.target.reset();
      qs('#create-group-modal').close();
      loadGroups();
    } catch(err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // Composer (create post with optional image)
  const postForm = qs('#post-form');
  postForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await createPost(e.target); }
    catch (err) { toast(err.message, true); }
  });
  postForm.content.addEventListener('input', (e) => {
    qs('#post-count').textContent = `${e.target.value.length} / 1000`;
  });
  qs('#image-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const preview = qs('#image-preview');
    const img = qs('img', preview);
    if (file) {
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(file);
      preview.hidden = false;
    }
  });
  qs('#image-remove').addEventListener('click', () => {
    qs('#image-input').value = '';
    const preview = qs('#image-preview');
    const img = qs('img', preview);
    if (img.src) URL.revokeObjectURL(img.src);
    img.removeAttribute('src');
    preview.hidden = true;
  });

  // Delegated post / user-card / conversation interactions
  const container = qs('.container');
  container.addEventListener('click', onContainerClick);
  container.addEventListener('submit', onContainerSubmit);

  // Profile actions
  qs('#follow-btn').addEventListener('click', toggleFollowProfile);
  qs('#message-btn').addEventListener('click', (e) => {
    const b = e.currentTarget;
    openChat({ id: Number(b.dataset.userId), username: b.dataset.username, avatar: b.dataset.avatar || null });
  });
  qs('#edit-profile-btn').addEventListener('click', () => {
    const f = qs('#edit-profile-form');
    f.hidden = !f.hidden;
  });
  qs('#edit-cancel').addEventListener('click', () => { qs('#edit-profile-form').hidden = true; });
  qs('#edit-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveProfile(e.target);
    e.target.hidden = true;
  });

  // Search (debounced)
  qs('#search-form').addEventListener('submit', (e) => e.preventDefault());
  qs('#search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(() => runSearch(q), 300);
  });

  // Chat
  qs('#chat-back').addEventListener('click', () => { stopChatPoll(); currentPeer = null; loadConversations(); });
  qs('#chat-peer').addEventListener('click', () => { if (currentPeer) openPublicProfile(currentPeer.username); });
  qs('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendMessage(e.target); });

  bootstrap();
}

document.addEventListener('DOMContentLoaded', init);
