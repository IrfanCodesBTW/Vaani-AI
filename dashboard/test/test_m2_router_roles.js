'use strict';

/**
 * Vaani AI Voice Agent Dashboard — Milestone M2 Router & Role Empirical Test Suite
 *
 * Empirical challenger harness for:
 * 1. Dynamic simulation of ROUTES and canAccessRoute(route, user) across all 6 roles
 * 2. Strict enforcement and boundary testing of adminOnly routes
 * 3. Strict enforcement and boundary testing of ownerOnly routes
 * 4. Router DOM synchronization: pill, rail, overflow dropdown, has-active-child
 * 5. viewHead command header action proxying into .command-controls
 * 6. Adversarial edge cases, state leaks, and malformed hash resilience
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Lightweight Mock DOM for headless evaluation
class DOMNode {
  constructor(nodeType, nodeName) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.childNodes = [];
    this.parentNode = null;
  }

  appendChild(child) {
    if (!child) return child;
    if (child.nodeType === 11) { // DocumentFragment
      const kids = [...child.childNodes];
      kids.forEach(k => this.appendChild(k));
      child.childNodes = [];
      return child;
    }
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  get textContent() {
    return this.childNodes.map(c => c.textContent).join('');
  }

  set textContent(val) {
    this.childNodes = [];
    if (val != null && val !== '') {
      this.appendChild(new DOMTextNode(String(val)));
    }
  }
}

class DOMTextNode extends DOMNode {
  constructor(text) {
    super(3, '#text');
    this.data = text;
  }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class DOMElement extends DOMNode {
  constructor(tagName) {
    super(1, tagName.toUpperCase());
    this.tagName = tagName.toUpperCase();
    this.attributes = {};
    this.listeners = {};
    this.style = {};
  }

  get id() { return this.attributes['id'] || ''; }
  set id(v) { if (v) this.attributes['id'] = v; else delete this.attributes['id']; }

  get className() { return this.attributes['class'] || ''; }
  set className(v) { if (v) this.attributes['class'] = v; else delete this.attributes['class']; }

  get classList() {
    const self = this;
    return {
      add(...classes) {
        const set = new Set((self.className || '').split(/\s+/).filter(Boolean));
        classes.forEach(c => set.add(c));
        self.className = Array.from(set).join(' ');
      },
      remove(...classes) {
        const set = new Set((self.className || '').split(/\s+/).filter(Boolean));
        classes.forEach(c => set.delete(c));
        self.className = Array.from(set).join(' ');
      },
      toggle(c, force) {
        const set = new Set((self.className || '').split(/\s+/).filter(Boolean));
        let res;
        if (typeof force === 'boolean') {
          if (force) set.add(c); else set.delete(c);
          res = force;
        } else {
          if (set.has(c)) { set.delete(c); res = false; }
          else { set.add(c); res = true; }
        }
        self.className = Array.from(set).join(' ');
        return res;
      },
      contains(c) {
        const set = new Set((self.className || '').split(/\s+/).filter(Boolean));
        return set.has(c);
      }
    };
  }

  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
  hasAttribute(k) { return this.attributes[k] !== undefined; }
  removeAttribute(k) { delete this.attributes[k]; }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  removeEventListener(event, fn) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(f => f !== fn);
  }
  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    const fns = this.listeners[type] || [];
    fns.forEach(fn => fn({ ...event, target: this, currentTarget: this }));
  }

  contains(other) {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  focus() {}

  get innerHTML() {
    return this.childNodes.map(c => {
      if (c.nodeType === 3) return c.data;
      if (c.nodeType === 1) {
        const attrs = Object.entries(c.attributes).map(([k, v]) => ` ${k}="${v}"`).join('');
        return `<${c.tagName.toLowerCase()}${attrs}>${c.innerHTML}</${c.tagName.toLowerCase()}>`;
      }
      return '';
    }).join('');
  }

  set innerHTML(html) {
    this.childNodes = [];
    if (!html) return;
    this.appendChild(new DOMTextNode(html));
  }

  querySelector(selector) {
    return queryOne(this, selector);
  }

  querySelectorAll(selector) {
    return queryAll(this, selector);
  }
}

class DOMDocumentFragment extends DOMNode {
  constructor() {
    super(11, '#document-fragment');
  }
}

function matchSimple(el, part) {
  if (el.nodeType !== 1) return false;
  const tagMatch = part.match(/^[a-zA-Z0-9]+/);
  if (tagMatch && el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;

  const idMatches = part.match(/#[a-zA-Z0-9_-]+/g);
  if (idMatches) {
    for (const m of idMatches) {
      if (el.id !== m.slice(1)) return false;
    }
  }

  const classMatches = part.match(/\.[a-zA-Z0-9_-]+/g);
  if (classMatches) {
    for (const m of classMatches) {
      if (!el.classList.contains(m.slice(1))) return false;
    }
  }

  const attrMatches = part.match(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]*)["']?)?\]/g);
  if (attrMatches) {
    for (const m of attrMatches) {
      const inner = m.slice(1, -1);
      const eqIdx = inner.indexOf('=');
      if (eqIdx === -1) {
        if (!el.hasAttribute(inner)) return false;
      } else {
        const k = inner.slice(0, eqIdx);
        let v = inner.slice(eqIdx + 1);
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (el.getAttribute(k) !== v) return false;
      }
    }
  }
  return true;
}

function matchesSelector(el, selector) {
  const parts = selector.trim().split(/\s+/);
  let currentEl = el;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (i === parts.length - 1) {
      if (!matchSimple(currentEl, part)) return false;
    } else {
      let found = false;
      let ancestor = currentEl.parentNode;
      while (ancestor) {
        if (ancestor.nodeType === 1 && matchSimple(ancestor, part)) {
          found = true;
          currentEl = ancestor;
          break;
        }
        ancestor = ancestor.parentNode;
      }
      if (!found) return false;
    }
  }
  return true;
}

function collectAllElements(root) {
  const list = [];
  function traverse(n) {
    if (n.nodeType === 1) list.push(n);
    for (const c of n.childNodes) traverse(c);
  }
  for (const c of root.childNodes) traverse(c);
  return list;
}

function queryAll(root, selector) {
  const subSelectors = selector.split(',').map(s => s.trim());
  const all = collectAllElements(root);
  return all.filter(el => subSelectors.some(sel => matchesSelector(el, sel)));
}

function queryOne(root, selector) {
  const list = queryAll(root, selector);
  return list.length > 0 ? list[0] : null;
}

function createDashboardAppSandbox(initialUser = null) {
  const doc = new DOMElement('HTML');
  const body = new DOMElement('BODY');
  doc.appendChild(body);

  const appDiv = new DOMElement('DIV');
  appDiv.id = 'app';
  body.appendChild(appDiv);

  const toastsDiv = new DOMElement('DIV');
  toastsDiv.id = 'toasts';
  body.appendChild(toastsDiv);

  const modalHost = new DOMElement('DIV');
  modalHost.id = 'modal-host';
  body.appendChild(modalHost);

  const windowListeners = {};
  const documentListeners = {};

  const documentMock = {
    readyState: 'loading',
    createElement(tag) { return new DOMElement(tag); },
    createElementNS(ns, tag) { return new DOMElement(tag); },
    createTextNode(text) { return new DOMTextNode(text); },
    createDocumentFragment() { return new DOMDocumentFragment(); },
    querySelector(sel) { return queryOne(doc, sel); },
    querySelectorAll(sel) { return queryAll(doc, sel); },
    addEventListener(event, fn) {
      documentListeners[event] = documentListeners[event] || [];
      documentListeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (documentListeners[event]) {
        documentListeners[event] = documentListeners[event].filter(f => f !== fn);
      }
    },
    body: body,
    title: 'Vaani AI'
  };

  const locationMock = {
    hash: '#/overview',
    href: 'http://localhost/#/overview'
  };

  const windowMock = {
    innerWidth: 1200,
    addEventListener(event, fn) {
      windowListeners[event] = windowListeners[event] || [];
      windowListeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (windowListeners[event]) {
        windowListeners[event] = windowListeners[event].filter(f => f !== fn);
      }
    },
    document: documentMock,
    location: locationMock,
    VaaniCharts: undefined
  };

  const mockFetch = async (url, opts) => {
    if (url === '/api/health') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, providers: { tts: { rumik: true }, llm: { groq: true }, telephony: { dograh: true } } })
      };
    }
    if (url === '/api/organizations') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ organizations: [] })
      };
    }
    if (url === '/api/me') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          user: initialUser || { id: 'usr_default', email: 'owner@vaani.ai', name: 'Default Owner', role: 'owner' },
          tenant: { id: 'ten_default', name: 'Default Tenant', plan: 'studio' }
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({})
    };
  };

  const sandbox = {
    document: documentMock,
    window: windowMock,
    location: locationMock,
    fetch: mockFetch,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    AbortController: AbortController,
    console: { log: () => {}, warn: () => {}, error: () => {} }
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const appJsCode = fs.readFileSync(path.join(__dirname, '../public/assets/app.js'), 'utf8');

  // Inject export hook into the runtime context without touching the disk file
  const codeToRun = appJsCode + `
    globalThis.__APP_EXPORTS__ = {
      ROUTES,
      canAccessRoute,
      isPlatformUserClient,
      clientOrgRole,
      renderShell,
      updateActiveNav,
      currentRoute,
      onRoute,
      goto,
      viewHead,
      State,
      el,
      $,
      $$
    };
  `;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(codeToRun, ctx);

  if (initialUser) {
    sandbox.__APP_EXPORTS__.State.me = {
      user: initialUser,
      tenant: { id: 'ten_mock', name: 'Mock Org', plan: 'studio' }
    };
  }

  return {
    doc,
    body,
    documentMock,
    windowMock,
    locationMock,
    windowListeners,
    documentListeners,
    exports: sandbox.__APP_EXPORTS__
  };
}

// --------------------------------------------------------------------------
// TEST SUITE 1: DYNAMIC SIMULATION OF ROUTES & canAccessRoute ACROSS 6 ROLES
// --------------------------------------------------------------------------
test('Empirical Challenger Suite: Milestone M2 Router & Role Permissions', async (t) => {

  await t.test('1. Dynamic simulation of ROUTES across all 6 roles (14 routes x 6 roles = 84 cases)', async (t1) => {
    const env = createDashboardAppSandbox();
    const { ROUTES, canAccessRoute, State } = env.exports;

    assert.equal(ROUTES.length, 14, 'Total routes must equal 14');

    const ROLES = ['viewer', 'analyst', 'operator', 'owner', 'admin', 'super_admin'];
    const expectedCounts = {
      viewer: 9,      // 14 - 1 adminOnly - 4 ownerOnly = 9
      analyst: 9,     // same
      operator: 9,    // same
      owner: 13,      // 9 non-gated + 4 ownerOnly = 13 (blocked from admin)
      admin: 14,      // all 14 routes
      super_admin: 14 // all 14 routes
    };

    for (const role of ROLES) {
      await t1.test(`Role [${role}] access matrix across all 14 routes`, () => {
        const user = { id: `usr_${role}`, role: role, name: `${role} user` };
        State.me = { user, tenant: { id: 'ten_test', name: 'Test Org' } };

        const accessible = ROUTES.filter(r => canAccessRoute(r, user));
        assert.equal(
          accessible.length,
          expectedCounts[role],
          `Role [${role}] expected ${expectedCounts[role]} accessible routes, got ${accessible.length}`
        );

        // Spot-check individual route expectations
        for (const route of ROUTES) {
          const allowed = canAccessRoute(route, user);
          if (route.adminOnly) {
            const expectAdmin = (role === 'admin' || role === 'super_admin');
            assert.equal(allowed, expectAdmin, `Route [${route.id}] adminOnly rule failed for [${role}]`);
          } else if (route.ownerOnly) {
            const expectOwner = (role === 'owner' || role === 'admin' || role === 'super_admin');
            assert.equal(allowed, expectOwner, `Route [${route.id}] ownerOnly rule failed for [${role}]`);
          } else {
            assert.equal(allowed, true, `Standard route [${route.id}] must be accessible for [${role}]`);
          }
        }
      });
    }
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 2: STRICT ISOLATION & VERIFICATION OF adminOnly ROUTES
  // --------------------------------------------------------------------------
  await t.test('2. adminOnly routes verification and security boundaries', async (t2) => {
    const env = createDashboardAppSandbox();
    const { ROUTES, canAccessRoute, State, isPlatformUserClient } = env.exports;

    const adminRoutes = ROUTES.filter(r => r.adminOnly);
    assert.equal(adminRoutes.length, 1, 'Exactly one adminOnly route must exist');
    assert.equal(adminRoutes[0].id, 'admin', 'adminOnly route must be #/admin');

    const adminRoute = adminRoutes[0];

    await t2.test('adminOnly blocked for viewer, analyst, operator, owner', () => {
      const blockedRoles = ['viewer', 'analyst', 'operator', 'owner'];
      blockedRoles.forEach(role => {
        const user = { id: 'u1', role };
        State.me = { user, tenant: { id: 't1', name: 'T' } };
        assert.equal(
          canAccessRoute(adminRoute, user),
          false,
          `adminOnly route must be BLOCKED for role [${role}]`
        );
      });
    });

    await t2.test('adminOnly allowed for admin, super_admin', () => {
      const allowedRoles = ['admin', 'super_admin'];
      allowedRoles.forEach(role => {
        const user = { id: 'u1', role };
        State.me = { user, tenant: { id: 't1', name: 'T' } };
        assert.equal(
          canAccessRoute(adminRoute, user),
          true,
          `adminOnly route must be ALLOWED for role [${role}]`
        );
      });
    });

    await t2.test('adminOnly fails closed for unauthenticated / falsy / forged users', () => {
      State.me = null;
      assert.equal(canAccessRoute(adminRoute, null), false, 'Null user must be blocked');
      assert.equal(canAccessRoute(adminRoute, undefined), false, 'Undefined user must be blocked');
      assert.equal(canAccessRoute(adminRoute, {}), false, 'Empty user object must be blocked');
      assert.equal(canAccessRoute(adminRoute, { role: 'hacker' }), false, 'Forged role must be blocked');
      assert.equal(canAccessRoute(adminRoute, { role: '' }), false, 'Empty role must be blocked');
    });

    await t2.test('isPlatformUserClient helper contract', () => {
      assert.equal(isPlatformUserClient({ role: 'super_admin' }), true);
      assert.equal(isPlatformUserClient({ role: 'admin' }), true);
      assert.equal(isPlatformUserClient({ role: 'owner' }), false);
      assert.equal(isPlatformUserClient({ role: 'operator' }), false);
      assert.equal(isPlatformUserClient({ role: 'analyst' }), false);
      assert.equal(isPlatformUserClient({ role: 'viewer' }), false);
      assert.equal(isPlatformUserClient(null), false);
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 3: STRICT ISOLATION & VERIFICATION OF ownerOnly ROUTES
  // --------------------------------------------------------------------------
  await t.test('3. ownerOnly routes verification and security boundaries', async (t3) => {
    const env = createDashboardAppSandbox();
    const { ROUTES, canAccessRoute, State, clientOrgRole } = env.exports;

    const ownerRoutes = ROUTES.filter(r => r.ownerOnly);
    assert.equal(ownerRoutes.length, 4, 'Exactly four ownerOnly routes must exist');
    const ownerRouteIds = ownerRoutes.map(r => r.id).sort();
    assert.deepEqual([...ownerRouteIds], ['agency-prompt', 'demos', 'integrations', 'invoices']);

    await t3.test('ownerOnly blocked for viewer, analyst, operator', () => {
      const blockedRoles = ['viewer', 'analyst', 'operator'];
      blockedRoles.forEach(role => {
        const user = { id: 'u1', role };
        State.me = { user, tenant: { id: 't1', name: 'T' } };
        ownerRoutes.forEach(r => {
          assert.equal(
            canAccessRoute(r, user),
            false,
            `ownerOnly route [${r.id}] must be BLOCKED for [${role}]`
          );
        });
      });
    });

    await t3.test('ownerOnly allowed for owner, admin, super_admin', () => {
      const allowedRoles = ['owner', 'admin', 'super_admin'];
      allowedRoles.forEach(role => {
        const user = { id: 'u1', role };
        State.me = { user, tenant: { id: 't1', name: 'T' } };
        ownerRoutes.forEach(r => {
          assert.equal(
            canAccessRoute(r, user),
            true,
            `ownerOnly route [${r.id}] must be ALLOWED for [${role}]`
          );
        });
      });
    });

    await t3.test('Multi-tenant membership orgRole owner elevation', () => {
      // User is global member, but tenant membership is owner
      const user = { id: 'u1', role: 'member', orgRole: 'owner' };
      State.me = { user, tenant: { id: 't1', name: 'T' } };
      ownerRoutes.forEach(r => {
        assert.equal(
          canAccessRoute(r, user),
          true,
          `ownerOnly route [${r.id}] must be ALLOWED for orgRole owner`
        );
      });
    });

    await t3.test('Multi-tenant membership object role owner elevation', () => {
      const user = { id: 'u1', role: 'member' };
      State.me = { user, membership: { role: 'owner' }, tenant: { id: 't1', name: 'T' } };
      ownerRoutes.forEach(r => {
        assert.equal(
          canAccessRoute(r, user),
          true,
          `ownerOnly route [${r.id}] must be ALLOWED when State.me.membership.role is owner`
        );
      });
    });

    // Adversarial finding verification: Decoupled parameter vs State.me
    await t3.test('Adversarial finding: canAccessRoute depends on State.me for ownerOnly checks', () => {
      // If State.me has viewer, but caller passes user with role: owner directly:
      State.me = { user: { id: 'u_viewer', role: 'viewer' }, tenant: { id: 't1' } };
      const passedOwner = { id: 'u_owner', role: 'owner' };
      
      // Because clientOrgRole() reads State.me.user instead of the passed parameter,
      // canAccessRoute returns false when State.me is out-of-sync!
      const resultWithOutOfSyncState = canAccessRoute(ownerRoutes[0], passedOwner);
      assert.equal(
        resultWithOutOfSyncState,
        false,
        'Demonstrates coupling: canAccessRoute checks State.me.user rather than the passed user argument for clientOrgRole'
      );

      // When State.me is synced with the owner user, it correctly returns true
      State.me.user = passedOwner;
      assert.equal(canAccessRoute(ownerRoutes[0], passedOwner), true);
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 4: ROUTER SYNCHRONIZATION LOGIC & DOM STATE
  // --------------------------------------------------------------------------
  await t.test('4. Router synchronization across pill, rail, overflow dropdown and titles', async (t4) => {
    // Setup environment with super_admin so all 14 routes are rendered into the DOM
    const user = { id: 'usr_admin', email: 'admin@vaani.ai', name: 'Super Admin', role: 'super_admin' };
    const env = createDashboardAppSandbox(user);
    const { renderShell, updateActiveNav, currentRoute, goto, ROUTES } = env.exports;
    const { documentMock, windowMock, locationMock } = env;

    // Render the complete shell
    renderShell();

    // Verify DOM components exist
    const primaryPills = documentMock.querySelectorAll('.nav-pill-group .nav-pill[data-route]');
    const railItems = documentMock.querySelectorAll('.side-rail .rail-item[data-route]');
    const dropdownItems = documentMock.querySelectorAll('#overflowDropdownMenu a[data-route]');
    const dropdownTrigger = documentMock.querySelector('#overflowDropdownTrigger');
    const mobileItems = documentMock.querySelectorAll('.mobile-drawer .mobile-nav-item[data-route]');

    assert.equal(primaryPills.length, 5, 'Must have exactly 5 primary pill routes');
    assert.equal(railItems.length, 4, 'Must have exactly 4 rail routes (overview, demos, telephony, settings)');
    assert.equal(dropdownItems.length, 9, 'Must have exactly 9 secondary dropdown routes');
    assert.ok(dropdownTrigger, '#overflowDropdownTrigger must be present');
    assert.equal(mobileItems.length, 14, 'Mobile drawer must include all 14 accessible routes');

    // Test each of the 14 routes
    for (const r of ROUTES) {
      await t4.test(`Router state synchronization for route [${r.id}] (${r.label})`, () => {
        locationMock.hash = '#/' + r.id;
        assert.equal(currentRoute(), r.id, `currentRoute() should match hash for [${r.id}]`);

        updateActiveNav(r.id);

        // 1. Check Primary Pills
        if (r.primary) {
          const pill = documentMock.querySelector(`.nav-pill-group .nav-pill[data-route="${r.id}"]`);
          assert.ok(pill, `Pill for ${r.id} must exist`);
          assert.ok(pill.classList.contains('active'), `Pill [${r.id}] must have .active`);
          assert.equal(pill.getAttribute('aria-selected'), 'true');
        } else {
          // Verify no primary pill is active
          primaryPills.forEach(p => {
            assert.equal(p.classList.contains('active'), false, `Pill [${p.getAttribute('data-route')}] must NOT be active when on [${r.id}]`);
          });
        }

        // 2. Check Rail Items
        if (r.rail) {
          const railItem = documentMock.querySelector(`.side-rail .rail-item[data-route="${r.id}"]`);
          assert.ok(railItem, `Rail item for ${r.id} must exist`);
          assert.ok(railItem.classList.contains('active'), `Rail item [${r.id}] must have .active`);
        } else {
          railItems.forEach(ri => {
            assert.equal(ri.classList.contains('active'), false, `Rail item [${ri.getAttribute('data-route')}] must NOT be active when on [${r.id}]`);
          });
        }

        // 3. Check Overflow Dropdown Trigger & Items
        if (r.secondary) {
          assert.ok(dropdownTrigger.classList.contains('has-active-child'), `Dropdown trigger must have .has-active-child when secondary route [${r.id}] is active`);
          assert.ok(dropdownTrigger.classList.contains('active'), `Dropdown trigger must have .active when secondary route [${r.id}] is active`);

          const ddItem = documentMock.querySelector(`#overflowDropdownMenu a[data-route="${r.id}"]`);
          assert.ok(ddItem, `Dropdown item for ${r.id} must exist`);
          assert.ok(ddItem.classList.contains('active'), `Dropdown item [${r.id}] must have .active`);
        } else {
          assert.equal(dropdownTrigger.classList.contains('has-active-child'), false, `Dropdown trigger must NOT have .has-active-child when primary route [${r.id}] is active`);
          assert.equal(dropdownTrigger.classList.contains('active'), false, `Dropdown trigger must NOT have .active when primary route [${r.id}] is active`);
          dropdownItems.forEach(di => {
            assert.equal(di.classList.contains('active'), false, `Dropdown item [${di.getAttribute('data-route')}] must NOT be active when on [${r.id}]`);
          });
        }

        // 4. Check Mobile Drawer Item
        const mobItem = documentMock.querySelector(`.mobile-drawer .mobile-nav-item[data-route="${r.id}"]`);
        assert.ok(mobItem, `Mobile item for ${r.id} must exist`);
        assert.ok(mobItem.classList.contains('active'), `Mobile item [${r.id}] must have .active`);

        // 5. Check Document Title & Route Title
        assert.equal(documentMock.title, `${r.label} — Vaani AI`, `Document title should update to "${r.label} — Vaani AI"`);
        const tt = documentMock.querySelector('#routeTitle');
        if (tt) assert.equal(tt.textContent, r.label, `Header routeTitle text should match "${r.label}"`);
      });
    }

    await t4.test('Unauthorized route hash fallback to overview', () => {
      // Switch user to viewer
      env.exports.State.me.user = { id: 'u_viewer', role: 'viewer' };
      renderShell();

      // Viewer attempts to navigate to admin
      locationMock.hash = '#/admin';
      assert.equal(currentRoute(), 'overview', 'Viewer navigating to #/admin must fall back to "overview"');

      // Viewer attempts to navigate to demos
      locationMock.hash = '#/demos';
      assert.equal(currentRoute(), 'overview', 'Viewer navigating to #/demos must fall back to "overview"');

      // Malformed / nonexistent hash falls back to overview
      locationMock.hash = '#/nonexistent_xyz';
      assert.equal(currentRoute(), 'overview', 'Nonexistent hash must fall back to "overview"');

      locationMock.hash = '';
      assert.equal(currentRoute(), 'overview', 'Empty hash must fall back to "overview"');
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 5: COMMAND HEADER ACTION PROXYING (viewHead)
  // --------------------------------------------------------------------------
  await t.test('5. viewHead command header action proxying into .command-controls', async (t5) => {
    const env = createDashboardAppSandbox();
    const { viewHead, el } = env.exports;
    const { locationMock } = env;

    await t5.test('Overview viewHead creates command-header and default pill filters', () => {
      locationMock.hash = '#/overview';
      const head = viewHead('Overview', 'Live system telemetry');

      assert.ok(head.classList.contains('view-head'), 'Header has .view-head');
      assert.ok(head.classList.contains('command-header'), 'Header has .command-header');

      const controls = head.querySelector('.command-controls.view-actions');
      assert.ok(controls, '.command-controls.view-actions container must exist');

      const dateBtn = controls.querySelector('#hdrFilterDate');
      const agentBtn = controls.querySelector('#hdrFilterAgent');
      const tuneBtn = controls.querySelector('#hdrFilterTune');

      assert.ok(dateBtn, 'Date filter pill exists');
      assert.ok(agentBtn, 'Agent filter pill exists');
      assert.ok(tuneBtn, 'Tune shortcut pill exists');
    });

    await t5.test('viewHead appends single action passed as argument', () => {
      locationMock.hash = '#/agents';
      const customAction = el('button', { class: 'btn btn-primary', id: 'newAgentBtn' }, 'New Agent');
      const head = viewHead('Agents', 'Manage voice agents', customAction);

      const controls = head.querySelector('.command-controls');
      assert.ok(controls, '.command-controls exists');
      const foundBtn = controls.querySelector('#newAgentBtn');
      assert.equal(foundBtn, customAction, 'Passed action button must be attached inside .command-controls');
    });

    await t5.test('viewHead appends array of actions passed as argument', () => {
      locationMock.hash = '#/telephony';
      const btn1 = el('button', { class: 'btn', id: 'btnExport' }, 'Export');
      const btn2 = el('button', { class: 'btn btn-primary', id: 'btnDial' }, 'Dial');
      const head = viewHead('Telephony', 'Call records', [btn1, btn2]);

      const controls = head.querySelector('.command-controls');
      assert.equal(controls.querySelector('#btnExport'), btn1);
      assert.equal(controls.querySelector('#btnDial'), btn2);
    });

    await t5.test('head.appendChild proxying intercepts .btn and routes to .command-controls', () => {
      locationMock.hash = '#/studio';
      const head = viewHead('Voice Studio', 'Voice tuning');
      const controls = head.querySelector('.command-controls');

      const actionBtn = el('button', { class: 'btn btn-primary', id: 'proxiedBtn' }, 'Synthesize');
      
      // Legacy code calling head.appendChild(btn)
      head.appendChild(actionBtn);

      // Verify actionBtn was proxied into controls, NOT direct child of head
      assert.equal(
        actionBtn.parentNode,
        controls,
        'Action button with .btn appended to head must be proxied into .command-controls'
      );
      assert.ok(controls.querySelector('#proxiedBtn'));
    });

    await t5.test('head.appendChild proxying intercepts .pill-filter and .view-actions', () => {
      locationMock.hash = '#/invoices';
      const head = viewHead('Invoices', 'Billing ledger');
      const controls = head.querySelector('.command-controls');

      const filterPill = el('button', { class: 'pill-filter', id: 'proxiedFilter' }, 'Filter');
      const actionsWrap = el('div', { class: 'view-actions', id: 'proxiedWrap' });

      head.appendChild(filterPill);
      head.appendChild(actionsWrap);

      assert.equal(filterPill.parentNode, controls, '.pill-filter must be proxied to .command-controls');
      assert.equal(actionsWrap.parentNode, controls, '.view-actions must be proxied to .command-controls');
    });

    await t5.test('head.appendChild does NOT proxy non-action elements', () => {
      locationMock.hash = '#/settings';
      const head = viewHead('Settings', 'Configure workspace');
      const banner = el('div', { class: 'banner-notice', id: 'noticeElem' }, 'Notice');

      head.appendChild(banner);

      assert.equal(
        banner.parentNode,
        head,
        'Non-action elements appended to head must remain direct children of head'
      );
      assert.equal(head.querySelector('.command-controls #noticeElem'), null);
    });
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 6: CSS TOKEN CONFORMANCE & RESPONSIVENESS IN app.css
  // --------------------------------------------------------------------------
  await t.test('6. CSS token rules, active states and responsive selectors in app.css', () => {
    const cssPath = path.join(__dirname, '../public/assets/app.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Rule 1: .nav-pill.active
    assert.match(css, /\.nav-pill\.active\s*\{[^}]*background:\s*#2C2C2C/i, '.nav-pill.active must have #2C2C2C background');

    // Rule 2: .dropdown-trigger.has-active-child
    assert.match(css, /\.dropdown-trigger\.has-active-child\s*\{/i, '.dropdown-trigger.has-active-child must exist');
    assert.match(css, /\.dropdown-trigger\.has-active-child::before\s*\{[^}]*background:\s*var\(--color-accent-green\)/i, 'Active indicator dot must use --color-accent-green');

    // Rule 3: .command-controls and .command-header
    assert.match(css, /\.command-controls/i, '.command-controls must be defined');
    assert.match(css, /\.command-header/i, '.command-header must be defined');

    // Rule 4: Responsive breakpoints
    assert.match(css, /@media\s*\(max-width:\s*1080px\)/i, '1080px breakpoint must be present');
    assert.match(css, /@media\s*\(max-width:\s*900px\)/i, '900px breakpoint must be present');
    assert.match(css, /@media\s*\(max-width:\s*820px\)/i, '820px breakpoint must be present');
    assert.match(css, /@media\s*\(max-width:\s*560px\)/i, '560px breakpoint must be present');
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 7: ADVERSARIAL STRESS TESTS & FAILURE MODES
  // --------------------------------------------------------------------------
  await t.test('7. Adversarial stress tests, state desync and failure mode exploration', async (t7) => {
    const user = { id: 'usr_super', email: 'super@vaani.ai', name: 'Super User', role: 'super_admin' };
    const env = createDashboardAppSandbox(user);
    const { renderShell, updateActiveNav, currentRoute, viewHead, el, ROUTES } = env.exports;
    const { documentMock, locationMock, documentListeners } = env;

    renderShell();
    const dropdownTrigger = documentMock.querySelector('#overflowDropdownTrigger');

    await t7.test('Rapid consecutive route transitions preserve state cleanliness', () => {
      // 1. Secondary route: presets
      locationMock.hash = '#/presets';
      updateActiveNav('presets');
      assert.equal(dropdownTrigger.classList.contains('has-active-child'), true);
      assert.equal(dropdownTrigger.classList.contains('active'), true);
      assert.equal(documentMock.querySelector('#overflowDropdownMenu a[data-route="presets"]').classList.contains('active'), true);

      // 2. Transition immediately to primary route: agents
      locationMock.hash = '#/agents';
      updateActiveNav('agents');
      assert.equal(dropdownTrigger.classList.contains('has-active-child'), false, 'Trigger must lose has-active-child when moving to primary route');
      assert.equal(dropdownTrigger.classList.contains('active'), false);
      assert.equal(documentMock.querySelector('#overflowDropdownMenu a[data-route="presets"]').classList.contains('active'), false, 'Previous dropdown item must be deactivated');
      assert.equal(documentMock.querySelector('.nav-pill-group .nav-pill[data-route="agents"]').classList.contains('active'), true);

      // 3. Transition to rail + primary route: telephony
      locationMock.hash = '#/telephony';
      updateActiveNav('telephony');
      assert.equal(documentMock.querySelector('.side-rail .rail-item[data-route="telephony"]').classList.contains('active'), true);
      assert.equal(documentMock.querySelector('.nav-pill-group .nav-pill[data-route="telephony"]').classList.contains('active'), true);
      assert.equal(documentMock.querySelector('.nav-pill-group .nav-pill[data-route="agents"]').classList.contains('active'), false);
      assert.equal(dropdownTrigger.classList.contains('has-active-child'), false);

      // 4. Transition to rail + secondary + ownerOnly route: demos
      locationMock.hash = '#/demos';
      updateActiveNav('demos');
      assert.equal(documentMock.querySelector('.side-rail .rail-item[data-route="demos"]').classList.contains('active'), true);
      assert.equal(documentMock.querySelector('#overflowDropdownMenu a[data-route="demos"]').classList.contains('active'), true);
      assert.equal(dropdownTrigger.classList.contains('has-active-child'), true, 'Demos is secondary, so trigger must have has-active-child');

      // 5. Back to overview
      locationMock.hash = '#/overview';
      updateActiveNav('overview');
      assert.equal(documentMock.querySelector('.side-rail .rail-item[data-route="demos"]').classList.contains('active'), false);
      assert.equal(documentMock.querySelector('#overflowDropdownMenu a[data-route="demos"]').classList.contains('active'), false);
      assert.equal(dropdownTrigger.classList.contains('has-active-child'), false);
      assert.equal(documentMock.querySelector('.nav-pill-group .nav-pill[data-route="overview"]').classList.contains('active'), true);
      assert.equal(documentMock.querySelector('.side-rail .rail-item[data-route="overview"]').classList.contains('active'), true);
    });

    await t7.test('Malformed hashes and query parameters are safely handled', () => {
      // Query parameters in hash: #/overview?date=now&agent=all
      locationMock.hash = '#/overview?date=now&agent=all';
      assert.equal(currentRoute(), 'overview');

      locationMock.hash = '#/agents?filter=active';
      assert.equal(currentRoute(), 'agents');

      // Double slash - rejected to overview due to strict single-slash regex /^#\/?/
      locationMock.hash = '#//studio';
      assert.equal(currentRoute(), 'overview', 'Double-slash route is not canonical and falls back to overview');

      // Directory traversal attempt
      locationMock.hash = '#/../../admin';
      assert.equal(currentRoute(), 'overview', 'Path traversal attempt must fall back to overview');

      // XSS string
      locationMock.hash = '#/<script>alert(1)</script>';
      assert.equal(currentRoute(), 'overview', 'XSS attempt must fall back to overview');

      // Whitespace
      locationMock.hash = '#/   ';
      assert.equal(currentRoute(), 'overview', 'Whitespace hash must fall back to overview');
    });

    await t7.test('Impersonation mode safety restriction', () => {
      // Set impersonation as a viewer
      env.exports.State.me = {
        user: { id: 'usr_target', role: 'viewer', email: 'client@example.com' },
        tenant: { id: 'ten_client', name: 'Client Tenant' },
        impersonation: { reason: 'Support Ticket #42' }
      };

      // In impersonation mode as viewer, admin route must be blocked
      const adminRoute = ROUTES.find(r => r.id === 'admin');
      const demosRoute = ROUTES.find(r => r.id === 'demos');
      assert.equal(env.exports.canAccessRoute(adminRoute), false);
      assert.equal(env.exports.canAccessRoute(demosRoute), false);

      // Render shell in impersonation
      renderShell();
      const banner = documentMock.querySelector('.impersonation-banner');
      assert.ok(banner, '.impersonation-banner must be rendered during impersonation');
      assert.match(banner.textContent, /client@example\.com/);
      assert.match(banner.textContent, /Support Ticket #42/);
    });

    await t7.test('Dropdown escape key closes menu and manages aria-expanded', () => {
      // Re-render as super_admin
      env.exports.State.me = {
        user: { id: 'usr_super', role: 'super_admin' },
        tenant: { id: 'ten_main', name: 'Main' }
      };
      renderShell();

      const trigger = documentMock.querySelector('#overflowDropdownTrigger');
      const menu = documentMock.querySelector('#overflowDropdownMenu');
      const container = documentMock.querySelector('#nav-overflow-menu');

      assert.ok(trigger && menu && container);
      assert.ok(menu.classList.contains('hide'));
      assert.equal(trigger.getAttribute('aria-expanded'), 'false');

      // Click trigger to toggle open
      trigger.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
      assert.equal(menu.classList.contains('hide'), false);
      assert.equal(trigger.getAttribute('aria-expanded'), 'true');
      assert.equal(container.classList.contains('open'), true);

      // Escape key event on document
      const keydownListeners = documentListeners['keydown'] || [];
      keydownListeners.forEach(fn => fn({ key: 'Escape' }));

      // Menu must be closed and aria-expanded reset to false
      assert.equal(menu.classList.contains('hide'), true);
      assert.equal(trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(container.classList.contains('open'), false);
    });

    await t7.test('viewHead preserves interleaved control ordering and proxies multiple children', () => {
      locationMock.hash = '#/presets';
      const head = viewHead('Presets', 'Agent templates');
      const controls = head.querySelector('.command-controls');

      const btn1 = el('button', { class: 'btn', id: 'act1' }, 'Act 1');
      const btn2 = el('button', { class: 'btn btn-primary', id: 'act2' }, 'Act 2');
      const filter1 = el('button', { class: 'pill-filter', id: 'filt1' }, 'Filter 1');
      const nonAction = el('div', { class: 'desc-note', id: 'note1' }, 'Note');

      head.appendChild(btn1);
      head.appendChild(nonAction);
      head.appendChild(filter1);
      head.appendChild(btn2);

      // Action items in controls
      assert.equal(controls.querySelector('#act1'), btn1);
      assert.equal(controls.querySelector('#filt1'), filter1);
      assert.equal(controls.querySelector('#act2'), btn2);

      // Non-action item directly under head
      assert.equal(head.querySelector('#note1'), nonAction);
      assert.equal(controls.querySelector('#note1'), null);
    });
  });

});
