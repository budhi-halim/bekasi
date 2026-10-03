/** Pure data validation, formatting, and filtering. No DOM access. */

const supportedCurrencies = new Set(['IDR', 'USD']);
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const moneyFormatters = new Map();

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, path, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim())) {
    throw new Error(`${path} must be ${required ? 'a non-empty' : 'a'} text string.`);
  }
  return value.trim();
}

function array(value, path) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array, such as [].`);
  return value;
}

/** Accept local Indonesian numbers or explicit international numbers. */
export function normalizePhone(value) {
  if (typeof value !== 'string') return null;
  const source = value.trim();
  if (!source || !/^\+?[\d\s().-]+$/.test(source)) return null;
  let digits = source.replace(/\D/g, '');
  if (source.startsWith('+')) {
    // A leading + explicitly selects an international number.
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = `62${digits.slice(1)}`;
  } else if (digits.startsWith('8')) {
    digits = `62${digits}`;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export function whatsappUrl(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? `https://wa.me/${normalized}` : null;
}

/** Only allow genuine Google Maps destinations, never arbitrary executable URLs. */
export function normalizeMapsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim().replace(/\\+$/, ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const allowed = host === 'maps.app.goo.gl'
      || (host === 'goo.gl' && url.pathname.startsWith('/maps/'))
      || host === 'maps.google.com'
      || ((host === 'google.com' || host === 'www.google.com' || host === 'www.google.co.id')
        && /^\/maps(?:\/|$)/.test(url.pathname));
    return allowed ? url.href : null;
  } catch {
    return null;
  }
}

/** Rupiah uses Indonesian separators; USD uses US separators and two decimals. */
export function formatMoney(amount, currency) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw new Error('A price amount must be a finite, non-negative number.');
  }
  if (!supportedCurrencies.has(currency)) throw new Error('Use IDR or USD for a numeric price.');
  if (!moneyFormatters.has(currency)) {
    moneyFormatters.set(currency, new Intl.NumberFormat(currency === 'IDR' ? 'id-ID' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: currency === 'IDR' ? 0 : 2,
      maximumFractionDigits: 2
    }));
  }
  return moneyFormatters.get(currency).format(amount);
}

function normalizePrice(value, path) {
  if (value == null) return { amount: null, currency: null, note: 'TBA' };
  if (!isRecord(value)) throw new Error(`${path} must be an object with amount, currency, and note.`);
  const amount = value.amount ?? null;
  const currency = text(value.currency, `${path}.currency`).toUpperCase() || null;
  const note = text(value.note, `${path}.note`);
  if (currency !== null && !supportedCurrencies.has(currency)) {
    throw new Error(`${path}.currency must be "IDR", "USD", or null.`);
  }
  if (amount !== null) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new Error(`${path}.amount must be a non-negative number without currency symbols, or null.`);
    }
    if (currency === null) throw new Error(`${path}.currency is required when an amount is provided.`);
  }
  return { amount, currency, note: amount === null && !note ? 'TBA' : note };
}

/** Validate edits with field-specific messages, and return a fresh normalized object. */
export function normalizeDirectory(source) {
  if (!isRecord(source) || !Array.isArray(source.customers)) {
    throw new Error('The JSON root must be an object containing a "customers" array.');
  }
  const ids = new Set();
  const customers = source.customers.map((entry, customerIndex) => {
    const path = `customers[${customerIndex}]`;
    if (!isRecord(entry)) throw new Error(`${path} must be a customer object.`);
    const id = text(entry.id, `${path}.id`, true);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error(`${path}.id must use lowercase letters, numbers, and single hyphens.`);
    }
    if (ids.has(id)) throw new Error(`${path}.id duplicates "${id}". Each customer needs a unique id.`);
    ids.add(id);
    const name = text(entry.name, `${path}.name`, true);
    const locations = array(entry.locations, `${path}.locations`).map((location, index) => {
      const locationPath = `${path}.locations[${index}]`;
      if (!isRecord(location)) throw new Error(`${locationPath} must be a location object.`);
      const rawUrl = text(location.mapsUrl, `${locationPath}.mapsUrl`);
      const mapsUrl = normalizeMapsUrl(rawUrl);
      if (rawUrl && !mapsUrl) throw new Error(`${locationPath}.mapsUrl must be an HTTPS Google Maps link, or empty.`);
      const contacts = array(location.contacts, `${locationPath}.contacts`).map((person, personIndex) => {
        const personPath = `${locationPath}.contacts[${personIndex}]`;
        if (!isRecord(person)) throw new Error(`${personPath} must be a contact object.`);
        const phone = text(person.phone, `${personPath}.phone`);
        if (phone && !normalizePhone(phone)) {
          throw new Error(`${personPath}.phone must be a valid phone number in quotes, or empty.`);
        }
        return {
          name: text(person.name, `${personPath}.name`, true),
          role: text(person.role, `${personPath}.role`),
          note: text(person.note, `${personPath}.note`),
          phone,
          whatsappUrl: whatsappUrl(phone)
        };
      });
      return { label: text(location.label, `${locationPath}.label`), mapsUrl, contacts };
    });
    const products = array(entry.products, `${path}.products`).map((product, index) => {
      const productPath = `${path}.products[${index}]`;
      if (!isRecord(product)) throw new Error(`${productPath} must be a product object.`);
      return {
        name: text(product.name, `${productPath}.name`, true),
        code: text(product.code, `${productPath}.code`),
        price: normalizePrice(product.price, `${productPath}.price`)
      };
    });
    const customer = { id, name, locations, products };
    return { ...customer, searchText: customerSearchText(customer) };
  });
  return {
    title: text(source.title, 'title') || 'Bekasi Customer Directory',
    area: text(source.area, 'area') || 'Bekasi',
    customers
  };
}

export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu, '')
    .replace(/r\s*&\s*d/gi, 'rnd').toLowerCase().replace(/\s+/g, ' ').trim();
}

function customerSearchText(customer) {
  const values = [customer.name];
  for (const location of customer.locations) {
    values.push(location.label);
    for (const person of location.contacts) {
      values.push(person.name, person.role, person.note, person.phone,
        person.phone.replace(/\D/g, ''), normalizePhone(person.phone) || '');
    }
  }
  for (const product of customer.products) {
    values.push(product.name, product.code, product.price.note, product.price.currency || '');
    if (product.price.amount !== null) {
      values.push(String(product.price.amount), formatMoney(product.price.amount, product.price.currency));
    }
  }
  return normalizeSearch(values.join(' '));
}

export function selectCustomers(customers, { query = '', withProducts = false } = {}) {
  let normalized = normalizeSearch(query);
  // Spaced or hyphenated phone searches also match the punctuation-free index.
  if (/^\+?[\d\s().-]+$/.test(normalized) && normalized.replace(/\D/g, '').length >= 7) {
    normalized = normalized.replace(/\D/g, '');
  }
  const tokens = normalized.split(' ').filter(Boolean);
  const result = customers.filter(customer => (!withProducts || customer.products.length > 0)
    && tokens.every(token => customer.searchText.includes(token)));
  return result.sort((a, b) => collator.compare(a.name, b.name));
}

export function getStats(customers) {
  return customers.reduce((total, customer) => {
    total.customers += 1;
    total.locations += customer.locations.length;
    total.contacts += customer.locations.reduce((sum, location) => sum + location.contacts.length, 0);
    total.products += customer.products.length;
    total.withProducts += Number(customer.products.length > 0);
    return total;
  }, { customers: 0, locations: 0, contacts: 0, products: 0, withProducts: 0 });
}

export function initials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  return words.length > 1
    ? `${Array.from(words[0])[0]}${Array.from(words.at(-1))[0]}`.toUpperCase()
    : Array.from(words[0] || '?').slice(0, 2).join('').toUpperCase();
}

export function locationLabel(location, index, count) {
  return location.label || (count > 1 ? `Location ${index + 1}` : 'Location');
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
