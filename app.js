(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined
    ? window.Telegram.WebApp : null;
  const inTelegram = !!(tg && tg.platform && tg.platform !== 'unknown');
  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor('#14171F'); tg.setBackgroundColor('#14171F'); } catch (e) { /* старые клиенты */ }
  }

  const POS = ['dd1', 'dd2', 'sup', 't1', 't2'];
  const POS_INFO = {
    dd1: { role: 'Урон', cls: 'dmg', label: '1-й ДД' },
    dd2: { role: 'Урон', cls: 'dmg', label: '2-й ДД' },
    sup: { role: 'Поддержка', cls: 'sup', label: 'Саппорт' },
    t1: { role: 'Танк', cls: 'tank', label: '1-й танк' },
    t2: { role: 'Танк', cls: 'tank', label: '2-й танк' },
  };
  const SLOTS = ['weapon', 'gloves', 'armor', 'boots'];
  const SLOT_NAMES = { weapon: 'Меч', gloves: 'Перчатки', armor: 'Броня', boots: 'Сапоги' };
  const TROOP = {
    red: ['#5A2420', '#C9473B', '#F2A08F'],
    blue: ['#1F3557', '#3E7BD6', '#9CC3F5'],
    green: ['#1F4430', '#3C9A5F', '#9BDDB4'],
  };
  const ROLE_ICON = {
    dmg: 'M4 2l3 12M8 2l2 12M12 2l1 12',
    tank: 'M8 1.5l5.5 2v4.5c0 3.3-2.4 5.6-5.5 6.5-3.1-.9-5.5-3.2-5.5-6.5V3.5z',
    sup: 'M6 1.5h4M6.5 1.5v4L2.8 12.2A1.5 1.5 0 0 0 4.1 14.5h7.8a1.5 1.5 0 0 0 1.3-2.3L9.5 5.5v-4',
  };
  const SHIELD = 'M20 2 L37 8 V22 C37 33 30 40 20 44 C10 40 3 33 3 22 V8 Z';
  const STORE_KEY = 'state_v1';

  let ROUTES = null;
  const cap = (stars) => Math.min(ROUTES.maxLevel, ROUTES.baseCap + ROUTES.capPerStar * Math.max(0, stars));

  const state = {
    heroes: [], byId: {}, squad: {}, equipment: {},
    view: 'squad', activePos: 'dd1', heroPos: 'dd1', touched: new Set(['dd1']), result: null,
  };

  // ---------- Хранилище: облако Telegram, в браузере — localStorage ----------
  const cloud = inTelegram && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9') ? tg.CloudStorage : null;

  function loadSaved() {
    return new Promise((resolve) => {
      const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
      if (cloud) {
        cloud.getItem(STORE_KEY, (err, value) => resolve(err ? null : parse(value)));
      } else {
        try { resolve(parse(localStorage.getItem(STORE_KEY))); } catch (e) { resolve(null); }
      }
    });
  }

  let saveTimer = null;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const value = JSON.stringify({ squad: state.squad, equipment: state.equipment });
      if (cloud) cloud.setItem(STORE_KEY, value, () => {});
      else { try { localStorage.setItem(STORE_KEY, value); } catch (e) { /* приватный режим */ } }
    }, 500);
  }

  // ---------- Расчет (тот же алгоритм, что app/logic.py в боте) ----------
  function analyze() {
    const filled = POS.filter((p) => state.squad[p]);
    const hero = (p) => state.byId[state.squad[p]];
    const levels = [];
    let seen = new Set();
    for (const [position, slot, target] of ROUTES.levelRoute) {
      const key = position + slot;
      if (!filled.includes(position) || seen.has(key)) continue;
      const it = item(state.squad[position], slot);
      const c = cap(it.stars);
      const goal = target === 'max' ? c : Math.min(target, c);
      if (it.level < goal) {
        seen.add(key);
        const unlocked = it.stars >= 1 && it.level >= cap(it.stars - 1);
        levels.push({ position, hero: hero(position).name, slot, from: it.level, to: goal, unlocked });
      }
    }
    const stars = [];
    seen = new Set();
    for (const [position, slot, target] of ROUTES.starRoute) {
      const key = position + slot;
      if (!filled.includes(position) || seen.has(key)) continue;
      const it = item(state.squad[position], slot);
      if (it.stars < target) {
        seen.add(key);
        stars.push({ position, hero: hero(position).name, slot, from: it.stars, to: target, capFrom: cap(it.stars), capTo: cap(target) });
      }
    }
    return { levels, stars, summary: summary(levels, stars) };
  }

  function summary(levels, stars) {
    const u = levels.find((s) => s.unlocked);
    if (u) {
      return { title: 'Эй, не упусти!', hot: true,
        text: `${u.hero}: звезда уже открыла уровни. ${SLOT_NAMES[u.slot]} можно качать с ${u.from} до ${u.to} — делай это первым делом.` };
    }
    if (levels.length) {
      const f = levels[0];
      let text = `Сначала уровни: ${f.hero} · ${SLOT_NAMES[f.slot].toLowerCase()} ${f.from} → ${f.to}.`;
      if (stars.length) text += ` По звёздам следующая цель — ${stars[0].hero} · ${SLOT_NAMES[stars[0].slot].toLowerCase()} ${stars[0].to}★.`;
      return { title: 'Главный вывод', text, hot: false };
    }
    if (stars.length) {
      const s = stars[0];
      return { title: 'Главный вывод', hot: false,
        text: `Уровни упёрлись в потолок. Теперь звёзды: ${s.hero} · ${SLOT_NAMES[s.slot].toLowerCase()} до ${s.to}★.` };
    }
    return { title: 'Главный вывод', text: 'Отряд прокачан по маршруту полностью.', hot: false };
  }

  // ---------- DOM-помощники (без innerHTML) ----------
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function svg(tag, attrs, ...children) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    children.forEach((c) => node.append(c));
    return node;
  }

  let clipSeq = 0;
  function emblem(hero, width) {
    const c = TROOP[hero.troop] || TROOP.red;
    const id = 'clip' + (++clipSeq);
    const text = svg('text', {
      x: 20, y: 25, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-family': 'Rubik, sans-serif', 'font-weight': 700, 'font-size': 14, fill: c[2],
    });
    text.textContent = initials(hero.name);
    return svg('svg', { viewBox: '0 0 40 46', width, height: Math.round(width * 46 / 40), 'aria-hidden': 'true' },
      svg('defs', {}, svg('clipPath', { id }, svg('path', { d: SHIELD }))),
      svg('path', { d: SHIELD, fill: c[0], stroke: c[1], 'stroke-width': 2 }),
      svg('path', { d: hero.ornament, 'clip-path': `url(#${id})`, fill: 'none', stroke: c[2], 'stroke-width': 3,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.5 }),
      text);
  }

  function roleIcon(cls) {
    const color = { dmg: 'var(--dmg)', sup: 'var(--sup)', tank: 'var(--tank)' }[cls];
    return svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: color,
      'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    svg('path', { d: ROLE_ICON[cls] }));
  }

  function initials(name) {
    const p = name.split(' ');
    return p.length > 1 ? p[0][0] + p[1][0] : name[0];
  }

  function haptic() { try { tg && tg.HapticFeedback.selectionChanged(); } catch (e) { /* ignore */ } }
  function alertBox(msg) { if (inTelegram && tg.showAlert) tg.showAlert(msg); else alert(msg); }

  // ---------- Данные ----------
  function item(heroId, slot) {
    const it = (state.equipment[heroId] || {})[slot];
    return it ? { level: it.level, stars: it.stars } : { level: 0, stars: 0 };
  }

  function setItem(heroId, slot, level, stars) {
    stars = Math.max(0, Math.min(5, stars));
    level = Math.max(0, Math.min(cap(stars), level));
    state.equipment[heroId] = Object.assign({}, state.equipment[heroId], { [slot]: { level, stars } });
    state.result = null;
    saveSoon();
    render();
  }

  // ---------- Удержание −/+ : уровень бежит сам и ускоряется ----------
  let hold = null;
  function stopHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold = null;
  }

  // Шаг на delta от текущего значения; возвращает новый уровень или null, если упёрлись в 0 / потолок
  function stepLevel(heroId, slot, delta) {
    const it = item(heroId, slot);
    const next = Math.max(0, Math.min(cap(it.stars), it.level + delta));
    if (next === it.level) return null;
    setItem(heroId, slot, next, it.stars);
    return next;
  }

  function startHold(heroId, slot, delta) {
    stopHold();
    blurLevelInput();
    if (stepLevel(heroId, slot, delta) === null) return;
    haptic();
    const started = Date.now();
    const tick = () => {
      if (!hold) return;
      const lvl = stepLevel(heroId, slot, delta);
      if (lvl === null) {
        stopHold();
        try { tg && tg.HapticFeedback.impactOccurred('medium'); } catch (e) { /* ignore */ }
        return;
      }
      if (lvl % 5 === 0) haptic();
      const t = Date.now() - started;
      hold.timer = setTimeout(tick, t > 2000 ? 40 : t > 1000 ? 80 : 140);
    };
    hold = { timer: setTimeout(tick, 400) };
  }

  // Кнопка перерисовывается на каждом шаге, поэтому отпускание ловим на всём окне
  ['pointerup', 'pointercancel', 'blur'].forEach((ev) => window.addEventListener(ev, stopHold));
  document.addEventListener('visibilitychange', stopHold);

  function holdBtn(text, label, heroId, slot, delta) {
    return el('button', {
      type: 'button', class: 'step-btn', text, 'aria-label': label,
      onpointerdown: (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        startHold(heroId, slot, delta);
      },
      // Клик мышью/пальцем уже обработан в pointerdown; здесь — только Enter/Пробел с клавиатуры
      onclick: (e) => { if (e.detail === 0) stepLevel(heroId, slot, delta); },
      oncontextmenu: (e) => e.preventDefault(),
    });
  }

  // ---------- Ввод уровня с клавиатуры ----------
  // Пока печатаешь, значение сразу пишется в состояние, но экран не перерисовывается
  // (иначе пропадёт фокус). Перерисовка — после ухода с поля и отпускания пальца,
  // чтобы не «съесть» нажатие на звезду или другую кнопку.
  let pointerIsDown = false;
  let pendingRender = false;
  window.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
  ['pointerup', 'pointercancel'].forEach((ev) => window.addEventListener(ev, () => {
    pointerIsDown = false;
    if (pendingRender) { pendingRender = false; setTimeout(render, 50); }
  }));

  function blurLevelInput() {
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains('level-input')) a.blur();
  }

  function levelInput(heroId, slot, it, c) {
    return el('input', {
      class: 'level-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
      enterkeyhint: 'done', maxlength: 2, autocomplete: 'off', value: String(it.level),
      'aria-label': `Уровень, от 0 до ${c}`,
      // При нажатии поле очищается (старое значение остаётся подсказкой) — сразу печатаешь новое
      onfocus: (e) => { e.target.placeholder = e.target.value; e.target.value = ''; },
      oninput: (e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
        if (digits !== e.target.value) e.target.value = digits;
        if (digits === '') return;
        const cur = item(heroId, slot);
        const level = Math.max(0, Math.min(cap(cur.stars), parseInt(digits, 10)));
        state.equipment[heroId] = Object.assign({}, state.equipment[heroId], { [slot]: { level, stars: cur.stars } });
        state.result = null;
        saveSoon();
      },
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      onblur: () => {
        if (pointerIsDown) pendingRender = true;
        else setTimeout(render, 0);
      },
    });
  }

  function filledCount() { return POS.filter((p) => state.squad[p]).length; }
  function nextEmpty(from) {
    const start = POS.indexOf(from);
    for (let k = 1; k <= POS.length; k++) {
      const p = POS[(start + k) % POS.length];
      if (!state.squad[p]) return p;
    }
    return null;
  }

  function go(view) {
    state.view = view;
    if (inTelegram) {
      if (view === 'squad') tg.BackButton.hide(); else tg.BackButton.show();
    }
    window.scrollTo(0, 0);
    render();
  }

  // ---------- Экран 1: отряд ----------
  function renderSquad() {
    const used = new Set(Object.values(state.squad));
    const activeCls = state.activePos ? POS_INFO[state.activePos].cls : null;

    const slot = (pos) => {
      const heroId = state.squad[pos];
      const hero = heroId && state.byId[heroId];
      const info = POS_INFO[pos];
      return el('button', {
        type: 'button',
        class: 'slot' + (hero ? ' filled' : '') + (pos === state.activePos ? ' active' : ''),
        'aria-label': info.role + (hero ? `: ${hero.name}, нажми чтобы убрать` : ': пусто'),
        onclick: () => {
          if (state.squad[pos]) { delete state.squad[pos]; state.result = null; saveSoon(); }
          state.activePos = pos;
          haptic();
          render();
        },
      },
      hero ? emblem(hero, 40) : el('div', { class: 'plus', text: '+' }),
      hero ? el('div', { class: 'name', text: hero.name }) : null,
      el('div', { class: 'role ' + info.cls, text: info.role }));
    };

    const heroCards = state.heroes.map((h) => {
      const isUsed = used.has(h.id);
      const fits = activeCls && h.cls === activeCls;
      return el('button', {
        type: 'button',
        class: 'hero' + (isUsed ? ' used' : fits ? ' fits' : activeCls ? ' dim' : ''),
        'aria-label': h.name + (isUsed ? ', уже в отряде' : ', добавить в отряд'),
        onclick: () => {
          if (isUsed || !state.activePos) return;
          state.squad[state.activePos] = h.id;
          state.activePos = nextEmpty(state.activePos);
          state.result = null;
          haptic();
          saveSoon();
          render();
        },
      },
      el('div', { class: 'top' }, roleIcon(h.cls)),
      emblem(h, 34),
      el('div', { class: 'name', text: h.name }));
    });

    const ready = filledCount() === 5;
    const hint = ready ? 'Отряд собран'
      : state.activePos ? 'Подсвечены: ' + POS_INFO[state.activePos].role.toLowerCase() : 'Нажми на ячейку';

    return [
      el('div', { class: 'head' },
        el('div', {}, el('div', { class: 'step', text: 'Шаг 1 из 3' }), el('h1', { text: 'Отряд' })),
        el('div', { class: 'counter', text: `${filledCount()} / 5` })),
      el('div', { class: 'formation' },
        el('div', { class: 'grid3' }, slot('dd1'), slot('dd2'), slot('sup')),
        el('div', { class: 'row2' }, slot('t1'), slot('t2'))),
      el('div', { class: 'hint', text: 'Сильнейшего ДД и сильнейшего танка ставь в левую ячейку' }),
      el('div', { class: 'row' }, el('h2', { text: 'Твои герои' }), el('div', { class: 'muted', text: hint })),
      el('div', { class: 'heroes' }, heroCards),
      el('div', { class: 'footer' },
        el('button', { type: 'button', class: 'btn ghost', text: 'Сброс', onclick: () => {
          state.squad = {}; state.activePos = 'dd1'; state.result = null; saveSoon(); render();
        } }),
        el('button', { type: 'button', class: 'btn primary', text: 'Далее: снаряжение', disabled: !ready,
          onclick: () => { state.heroPos = 'dd1'; state.touched = new Set(['dd1']); go('equip'); } })),
    ];
  }

  // ---------- Экран 2: снаряжение ----------
  function renderEquip() {
    const tabs = POS.map((pos) => {
      const hero = state.byId[state.squad[pos]];
      return el('button', {
        type: 'button', class: 'tab' + (pos === state.heroPos ? ' active' : ''),
        'aria-label': `${hero.name}, ${POS_INFO[pos].label}`,
        onclick: () => { state.heroPos = pos; state.touched.add(pos); haptic(); render(); },
      },
      emblem(hero, 30),
      el('div', { class: 'name', text: hero.name }),
      el('div', { class: 'pos', text: POS_INFO[pos].label }),
      el('div', { class: 'dot' + (state.touched.has(pos) ? ' on' : '') }));
    });

    const heroId = state.squad[state.heroPos];
    const hero = state.byId[heroId];

    const items = SLOTS.map((slot) => {
      const it = item(heroId, slot);
      const c = cap(it.stars);
      const headroom = it.level < c && it.level >= 20;
      const stars = [1, 2, 3, 4, 5].map((n) => el('button', {
        type: 'button', class: 'star' + (n <= it.stars ? ' on' : '') + (n === 5 ? ' red' : ''),
        'aria-label': `${n} из 5 звёзд`, text: '★',
        onclick: () => { const cur = item(heroId, slot); setItem(heroId, slot, cur.level, cur.stars === n ? n - 1 : n); },
      }));
      const chips = [...new Set([20, ROUTES.baseCap, c])].map((v) => el('button', {
        type: 'button', class: 'chip' + (v === it.level ? ' on' : ''),
        text: v === c && v !== 20 && v !== ROUTES.baseCap ? 'макс' : String(v),
        'aria-label': 'Уровень ' + v,
        onclick: () => setItem(heroId, slot, v, item(heroId, slot).stars),
      }));
      return el('div', { class: 'item' + (headroom ? ' headroom' : '') },
        el('div', { class: 'row' },
          el('div', { class: 'title' }, SLOT_NAMES[slot], headroom ? el('span', { class: 'badge', text: 'можно до ' + c }) : null),
          el('div', { class: 'stars', role: 'group', 'aria-label': `Звёзды: ${it.stars} из 5` }, stars)),
        el('div', { class: 'controls' },
          holdBtn('−', 'Уменьшить уровень (удерживай для быстрой смены)', heroId, slot, -1),
          el('div', { class: 'level' }, levelInput(heroId, slot, it, c), el('span', { text: 'ур. / ' + c })),
          holdBtn('+', 'Увеличить уровень (удерживай для быстрой смены)', heroId, slot, 1),
          el('div', { class: 'chips' }, chips)));
    });

    return [
      el('div', { class: 'head' },
        el('div', {}, el('div', { class: 'step', text: 'Шаг 2 из 3' }), el('h1', { text: 'Снаряжение' })),
        el('div', { class: 'muted', text: `Проверено ${state.touched.size} / 5` })),
      el('div', { class: 'tabs' }, tabs),
      el('div', { class: 'row' },
        el('div', { class: 'row' }, el('h2', { text: hero.name }), el('span', { class: 'role ' + POS_INFO[state.heroPos].cls, text: POS_INFO[state.heroPos].label })),
        el('div', { class: 'muted', text: `Потолок: ${ROUTES.baseCap} + ${ROUTES.capPerStar} за ★` })),
      ...items,
      el('div', { class: 'footer' },
        el('button', { type: 'button', class: 'btn ghost', text: 'Назад', onclick: () => go('squad') }),
        el('button', { type: 'button', class: 'btn primary', text: 'Анализировать отряд',
          onclick: () => { state.result = analyze(); go('result'); } })),
    ];
  }

  // ---------- Экран 3: результат ----------
  function stepCard(i, hot, what, act, tags) {
    return el('div', { class: 'stepcard' + (hot ? ' hot' : '') },
      el('div', { class: 'rank', text: i + 1 }),
      el('div', { class: 'body' },
        el('div', { class: 'row' }, el('span', { class: 'what', text: what }), el('span', { class: 'act', text: act })),
        el('div', { class: 'tags' }, tags)));
  }

  function renderResult() {
    const r = state.result;
    const levels = r.levels.slice(0, 6).map((s, i) => stepCard(i, i === 0 || s.unlocked,
      `${s.hero} · ${SLOT_NAMES[s.slot]}`, `${s.from} → ${s.to} ур.`,
      [el('span', { class: 'tag', text: POS_INFO[s.position].label }),
        s.unlocked ? el('span', { class: 'badge', text: '★ звезда открыла уровни' }) : null]));
    const stars = r.stars.slice(0, 4).map((s, i) => stepCard(i, i === 0,
      `${s.hero} · ${SLOT_NAMES[s.slot]}`, `${s.from}★ → ${s.to}★`,
      [el('span', { class: 'tag', text: POS_INFO[s.position].label }),
        el('span', { class: 'tag', text: `потолок ${s.capFrom} → ${s.capTo}` })]));

    return [
      el('div', {}, el('div', { class: 'step', text: 'Шаг 3 из 3' }), el('h1', { text: 'Что качать' })),
      el('div', { class: 'summary' + (r.summary.hot ? ' hot' : '') },
        el('div', { class: 't', text: r.summary.title }), el('div', { class: 'x', text: r.summary.text })),
      el('div', { class: 'row' }, el('h2', { text: 'Уровни' }), el('div', { class: 'muted', text: 'по текущим звёздам' })),
      levels.length ? el('div', { class: 'steps' }, levels)
        : el('div', { class: 'done', text: 'Все уровни на потолке. Дальше прокачку открывают звёзды.' }),
      el('div', { class: 'row' }, el('h2', { text: 'Звёзды' }), el('div', { class: 'muted', text: 'отдельный маршрут' })),
      stars.length ? el('div', { class: 'steps' }, stars) : el('div', { class: 'done', text: 'Звёздный маршрут пройден.' }),
      el('div', { class: 'note', text: '5★ качается только за красные чертежи, поэтому помощник не ставит её в маршрут.' }),
      el('div', { class: 'footer' },
        el('button', { type: 'button', class: 'btn ghost', text: 'Изменить', onclick: () => go('equip') }),
        el('button', { type: 'button', class: 'btn primary', text: 'Поделиться', onclick: shareResult })),
    ];
  }

  // ---------- Поделиться разбором (без бота) ----------
  function shareText() {
    const r = state.result;
    const lines = ['Last Asylum — что качать', '', r.summary.text];
    if (r.levels.length) {
      lines.push('', 'Уровни:');
      r.levels.slice(0, 6).forEach((s, i) => lines.push(`${i + 1}. ${s.hero} · ${SLOT_NAMES[s.slot]}: ${s.from} → ${s.to}`));
    }
    if (r.stars.length) {
      lines.push('', 'Звёзды:');
      r.stars.slice(0, 4).forEach((s, i) => lines.push(`${i + 1}. ${s.hero} · ${SLOT_NAMES[s.slot]}: ${s.from}★ → ${s.to}★`));
    }
    const n = (p) => state.byId[state.squad[p]].name;
    lines.push('', `Отряд: ДД ${n('dd1')}, ${n('dd2')} · саппорт ${n('sup')} · танки ${n('t1')}, ${n('t2')}`);
    return lines.join('\n');
  }

  async function shareResult() {
    const text = shareText();
    try { tg && tg.HapticFeedback.notificationOccurred('success'); } catch (e) { /* ignore */ }
    // В Telegram — стандартное окно «Переслать в…»; текст целиком в параметре url, чтобы не было лишней ссылки сверху
    if (inTelegram && tg.openTelegramLink) {
      tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(text));
      return;
    }
    // В обычном браузере — системное «Поделиться», иначе копируем текст
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); alertBox('Разбор скопирован — вставь его в нужный чат.'); }
    catch (e) { window.open('https://t.me/share/url?url=' + encodeURIComponent(text), '_blank'); }
  }

  // ---------- Общее ----------
  function render() {
    const app = document.getElementById('app');
    let view = state.view;
    if (view !== 'squad' && filledCount() < 5) view = state.view = 'squad';
    if (view === 'result' && !state.result) view = state.view = 'equip';
    const nodes = view === 'squad' ? renderSquad() : view === 'equip' ? renderEquip() : renderResult();
    app.replaceChildren(...nodes.filter(Boolean));
  }

  async function init() {
    if (inTelegram) tg.BackButton.onClick(() => go(state.view === 'result' ? 'equip' : 'squad'));
    try {
      const [heroes, routes, saved] = await Promise.all([
        fetch('data/heroes.json').then((r) => r.json()),
        fetch('data/routes.json').then((r) => r.json()),
        loadSaved(),
      ]);
      ROUTES = routes;
      state.heroes = heroes;
      state.byId = Object.fromEntries(heroes.map((h) => [h.id, h]));
      if (saved) {
        state.squad = Object.fromEntries(Object.entries(saved.squad || {}).filter(([p, id]) => POS.includes(p) && state.byId[id]));
        state.equipment = saved.equipment || {};
      }
      state.activePos = nextEmpty('t2');
      render();
    } catch (e) {
      document.getElementById('app').replaceChildren(el('p', { class: 'error', text: 'Не получилось загрузить данные. Закрой и открой помощника ещё раз.' }));
    }
  }

  init();
})();
