/** DOM rendering, accessibility, theme selection, and user interaction. */
(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const refs = {
    directory: byId('directory'), grid: byId('customer-grid'),
    toolbar: byId('toolbar'), filters: byId('filter-bar'),
    search: byId('search'), searchClear: byId('search-clear'),
    all: byId('filter-all'), products: byId('filter-products'),
    resultsBar: byId('results-bar'), resultCount: byId('result-count'),
    reset: byId('reset-view'), loading: byId('loading-state'),
    empty: byId('empty-state'), emptyReset: byId('empty-reset'),
    error: byId('error-state'), retry: byId('retry'), theme: byId('theme-toggle')
  };
  const state = { directory: null, query: '', withProducts: false };
  const cardCache = new Map();
  let logic;
  let loading = false;
  let renderFrame = 0;

  const iconPaths = {
    moon: '<path d="M20.6 13.1A8.8 8.8 0 0 1 10.9 3.4a8.8 8.8 0 1 0 9.7 9.7Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42m0-14.14-1.42 1.42M6.35 17.65l-1.42 1.42"/>',
    pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    package: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
    whatsapp: '<path d="M20.7 11.8a8.7 8.7 0 0 1-12.9 7.6L3 21l1.5-4.9A8.7 8.7 0 1 1 20.7 11.8Z"/><path d="M8.1 7.3c.3-.2.6-.2.8.2l1 2c.1.3.1.5-.1.7l-.6.7c.7 1.4 1.7 2.4 3.1 3.1l.7-.7c.2-.2.5-.2.7-.1l2 1c.3.2.4.5.2.8-.5 1-1.2 1.4-2.3 1.2-3.3-.6-6.2-3.5-6.8-6.8-.2-1.1.2-1.8 1.3-2.1Z"/>'
  };

  function element(tag, className = '', value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    // Only this fixed, developer-owned icon dictionary is parsed as markup.
    svg.innerHTML = iconPaths[name] || '';
    return svg;
  }

  function externalLink(url, className, label) {
    const link = element('a', `action-link ${className}`);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    link.draggable = false;
    link.setAttribute('aria-label', label);
    link.title = label;
    return link;
  }

  function renderContact(person, customer, siteName) {
    const row = element('li', 'contact');
    const info = element('div', 'contact-info');
    const name = element('p', 'contact-name', person.name);
    if (person.note) name.append(element('span', 'contact-note', ` (${person.note})`));
    info.append(name);
    if (person.role) info.append(element('p', 'contact-role', person.role));
    info.append(element('span', 'contact-phone', person.phone || 'Phone not recorded'));
    const chat = person.whatsappUrl
      ? externalLink(person.whatsappUrl, 'whatsapp-link', `Open WhatsApp with ${person.name}${person.role ? `, ${person.role}` : ''} — ${customer.name}, ${siteName}`)
      : element('span', 'action-link whatsapp-link is-disabled');
    if (!person.whatsappUrl) {
      chat.setAttribute('aria-disabled', 'true');
      chat.title = 'Add a phone number in data/customers.json to enable WhatsApp.';
    }
    chat.append(icon('whatsapp'), element('span', '', 'Chat'));
    row.append(info, chat);
    return row;
  }

  function renderLocation(location, index, customer) {
    const siteName = logic.locationLabel(location, index, customer.locations.length);
    const section = element('section', 'location-section');
    const titleId = `location-${customer.id}-${index}`;
    section.setAttribute('aria-labelledby', titleId);
    const header = element('div', 'location-header');
    const label = element('div', 'location-label');
    const title = element('h3', '', siteName);
    title.id = titleId;
    label.append(icon('pin'), title);
    header.append(label);
    if (location.mapsUrl) {
      const map = externalLink(location.mapsUrl, 'maps-link', `Open Google Maps for ${customer.name} — ${siteName}`);
      map.append(element('span', '', 'Open Maps'), icon('arrow'));
      header.append(map);
    } else {
      header.append(element('span', 'map-pending', 'Map not recorded'));
    }
    section.append(header);
    if (location.contacts.length) {
      const list = element('ul', 'contact-list');
      for (const contact of location.contacts) list.append(renderContact(contact, customer, siteName));
      section.append(list);
    } else {
      section.append(element('p', 'pending-copy', 'No contacts recorded.'));
    }
    return section;
  }

  function renderProduct(product) {
    const item = element('li', 'product');
    const row = element('div', 'product-main');
    const info = element('div', 'product-info');
    info.append(element('p', 'product-name', product.name));
    if (product.code) info.append(element('span', 'product-code', product.code));
    row.append(info);
    const price = product.price;
    if (price.amount !== null) {
      const value = element('div', 'price');
      const amount = element('p', 'price-amount', logic.formatMoney(price.amount, price.currency));
      amount.lang = price.currency === 'IDR' ? 'id' : 'en-US';
      value.append(amount, element('p', 'price-currency', price.currency));
      row.append(value);
    } else if (price.note.toUpperCase() === 'TBA') {
      const badge = element('span', 'price-tba', 'TBA');
      badge.setAttribute('aria-label', 'Price to be announced');
      row.append(badge);
    }
    item.append(row);
    if (price.note && !(price.amount === null && price.note.toUpperCase() === 'TBA')) {
      const note = element('p', 'price-note');
      note.append(icon('info'), element('span', '', price.note));
      item.append(note);
    }
    return item;
  }

  function renderProducts(customer) {
    if (!customer.products.length) {
      const empty = element('p', 'products-empty');
      empty.append(icon('package'), element('span', '', 'No products recorded'));
      return empty;
    }
    const section = element('section', 'products-section');
    const titleId = `products-${customer.id}`;
    section.setAttribute('aria-labelledby', titleId);
    const heading = element('div', 'products-heading');
    const title = element('h3', '', 'ORDERED PRODUCTS');
    title.id = titleId;
    heading.append(icon('package'), title, element('span', 'product-count', logic.plural(customer.products.length, 'item')));
    const list = element('ul', 'product-list');
    for (const product of customer.products) list.append(renderProduct(product));
    section.append(heading, list);
    return section;
  }

  function renderCustomer(customer) {
    const card = element('article', 'customer-card');
    card.id = `customer-${customer.id}`;
    card.setAttribute('aria-labelledby', `title-${customer.id}`);
    const header = element('div', 'card-header');
    const avatar = element('span', 'company-avatar', logic.initials(customer.name));
    avatar.setAttribute('aria-hidden', 'true');
    const company = element('div', 'company-info');
    const title = element('h2', '', customer.name);
    title.id = `title-${customer.id}`;
    const people = customer.locations.reduce((sum, site) => sum + site.contacts.length, 0);
    company.append(title, element('p', 'company-meta', `${logic.plural(customer.locations.length, 'location')} · ${logic.plural(people, 'contact')}`));
    header.append(avatar, company);
    const locations = element('div', 'card-locations');
    if (!customer.locations.length) {
      locations.append(element('p', 'pending-copy', 'No locations recorded.'));
    } else {
      customer.locations.forEach((location, index) => locations.append(renderLocation(location, index, customer)));
    }
    card.append(header, locations, renderProducts(customer));
    return card;
  }

  function renderResults() {
    if (!state.directory) return;
    const directoryTop = refs.directory.getBoundingClientRect().top + window.scrollY;
    const toolbarInset = parseFloat(getComputedStyle(refs.toolbar).top) || 0;
    const wasBrowsingResults = window.scrollY > directoryTop - toolbarInset + 1;
    const all = state.directory.customers;
    const visible = logic.selectCustomers(all, state);
    const fragment = document.createDocumentFragment();
    for (const customer of visible) {
      if (!cardCache.has(customer.id)) cardCache.set(customer.id, renderCustomer(customer));
      fragment.append(cardCache.get(customer.id));
    }
    refs.grid.replaceChildren(fragment);
    refs.grid.setAttribute('aria-busy', 'false');
    refs.searchClear.hidden = !state.query;
    refs.all.classList.toggle('is-active', !state.withProducts);
    refs.all.setAttribute('aria-pressed', String(!state.withProducts));
    refs.products.classList.toggle('is-active', state.withProducts);
    refs.products.setAttribute('aria-pressed', String(state.withProducts));
    refs.reset.hidden = !state.query && !state.withProducts;
    refs.resultCount.replaceChildren(element('strong', '', visible.length));
    refs.resultCount.append(document.createTextNode(visible.length === all.length
      ? ` ${visible.length === 1 ? 'customer' : 'customers'}`
      : ` of ${logic.plural(all.length, 'customer')}`));
    const ordering = element('span', 'sort-label', ' · A–Z');
    ordering.title = 'Alphabetical by company name';
    refs.resultCount.append(ordering);
    refs.empty.hidden = visible.length !== 0;
    refs.emptyReset.hidden = all.length === 0;
    byId('empty-title').textContent = all.length ? 'No matching customers' : 'No customers recorded';
    byId('empty-description').textContent = all.length
      ? 'No results for the current search or filter.'
      : 'Add a customer to data/customers.json and refresh this page.';
    // Keep the sticky search and the first new result visible after filtering deep in the list.
    if (wasBrowsingResults) {
      window.scrollTo({ top: Math.max(0, directoryTop - toolbarInset), behavior: 'instant' });
    }
  }

  function queueRender() {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(renderResults);
  }

  function resetView() {
    state.query = '';
    state.withProducts = false;
    refs.search.value = '';
    renderResults();
  }

  function renderOverview() {
    const directory = state.directory;
    const stats = logic.getStats(directory.customers);
    document.title = directory.title;
    byId('page-title').textContent = `${directory.area} customers`;
    byId('brand-area').textContent = `${directory.area} area`;
    document.querySelector('.brand').setAttribute('aria-label', `${directory.title}, top of page`);
    byId('stat-customers').textContent = stats.customers;
    byId('stat-locations').textContent = stats.locations;
    byId('stat-contacts').textContent = stats.contacts;
    byId('count-all').textContent = stats.customers;
    byId('count-products').textContent = stats.withProducts;
  }

  function showError(description, detail = '', fileMode = false) {
    refs.loading.hidden = true;
    refs.toolbar.hidden = true;
    refs.filters.hidden = true;
    refs.resultsBar.hidden = true;
    refs.empty.hidden = true;
    refs.grid.replaceChildren();
    refs.grid.setAttribute('aria-busy', 'false');
    refs.error.hidden = false;
    byId('error-title').textContent = fileMode ? 'Open the hosted page' : 'Unable to load customers';
    byId('error-description').textContent = description;
    byId('error-detail').textContent = detail;
    byId('error-detail').hidden = !detail;
    refs.retry.hidden = fileMode;
  }

  async function loadDirectory() {
    if (loading) return;
    loading = true;
    refs.error.hidden = true;
    refs.loading.hidden = false;
    refs.grid.setAttribute('aria-busy', 'true');
    refs.retry.disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      logic ??= await import('./logic.js');
      const response = await fetch(new URL('data/customers.json', document.baseURI), {
        cache: 'no-store', credentials: 'same-origin', signal: controller.signal
      });
      if (!response.ok) throw new Error(`data/customers.json returned HTTP ${response.status}. Check that the file exists.`);
      let source;
      try {
        source = await response.json();
      } catch (error) {
        throw new Error(`data/customers.json is not valid JSON. Check commas, double quotes, and brackets.\n${error.message}`);
      }
      state.directory = logic.normalizeDirectory(source);
      cardCache.clear();
      renderOverview();
      refs.toolbar.hidden = false;
      refs.filters.hidden = false;
      refs.resultsBar.hidden = false;
      renderResults();
    } catch (error) {
      const detail = error.name === 'AbortError' ? 'The request timed out. Check your connection and retry.' : error.message;
      showError('Check data/customers.json and make sure the webpage is being served over HTTP or HTTPS.', detail);
    } finally {
      clearTimeout(timeout);
      refs.loading.hidden = true;
      refs.retry.disabled = false;
      loading = false;
    }
  }

  function initializeTheme() {
    const system = matchMedia('(prefers-color-scheme: dark)');
    let explicitChoice = null;
    const updateButton = () => {
      const isDark = explicitChoice ?? system.matches;
      refs.theme.replaceChildren(icon(isDark ? 'sun' : 'moon'));
      const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;
      refs.theme.setAttribute('aria-label', label);
      refs.theme.title = label;
    };
    refs.theme.hidden = false;
    refs.theme.addEventListener('click', () => {
      explicitChoice = !(explicitChoice ?? system.matches);
      document.documentElement.classList.toggle('theme-dark', explicitChoice);
      document.documentElement.classList.toggle('theme-light', !explicitChoice);
      updateButton();
    });
    system.addEventListener('change', () => { if (explicitChoice === null) updateButton(); });
    updateButton();
  }

  refs.search.addEventListener('input', () => { state.query = refs.search.value; queueRender(); });
  refs.search.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.query) {
      event.preventDefault();
      state.query = '';
      refs.search.value = '';
      renderResults();
    } else if (event.key === 'Enter') {
      refs.search.blur();
    }
  });
  refs.searchClear.addEventListener('click', () => {
    state.query = '';
    refs.search.value = '';
    renderResults();
    refs.search.focus({ preventScroll: true });
  });
  refs.all.addEventListener('click', () => { state.withProducts = false; renderResults(); });
  refs.products.addEventListener('click', () => { state.withProducts = true; renderResults(); });
  refs.reset.addEventListener('click', resetView);
  refs.emptyReset.addEventListener('click', () => { resetView(); refs.search.focus({ preventScroll: true }); });
  refs.retry.addEventListener('click', loadDirectory);

  // Disable touch long-press previews on controls, not text copying or normal scrolling.
  document.addEventListener('contextmenu', event => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('button, .action-link, .brand')) return;
    if (event.pointerType === 'touch' || matchMedia('(pointer: coarse)').matches) event.preventDefault();
  });
  document.addEventListener('dragstart', event => {
    if (event.target instanceof Element && event.target.closest('.action-link, .brand')) event.preventDefault();
  });

  initializeTheme();
  if (location.protocol === 'file:') {
    showError('Use the GitHub Pages address or an HTTP server.',
      'Opening index.html directly cannot load data/customers.json.', true);
  } else {
    loadDirectory();
  }
})();
