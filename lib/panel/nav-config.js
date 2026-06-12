/**
 * PetFix Panel — MarketNext, Pazaryeri ve E-Ticaret modül navigasyonu.
 */

export const PANEL_MODULES = {
  marketnext: {
    id: 'marketnext',
    label: 'MarketNext',
    items: [
      { id: 'dashboard', href: '/marketnext', label: 'Ana Panel', icon: 'mn-dashboard', aliases: ['/quick-commerce', '/dashboard', '/marketnext/orders', '/quick-commerce/orders'] },
      { id: 'uber-eats', href: '/marketnext/orders/uber-eats', label: 'Uber Eats', icon: 'channel-uber', aliases: ['/uber-eats'] },
      { id: 'yemeksepeti', href: '/marketnext/orders/yemeksepeti', label: 'Yemeksepeti', icon: 'channel-ys', aliases: ['/yemeksepeti'] },
      { id: 'getir', href: '/marketnext/orders/getir', label: 'Getir', icon: 'channel-getir', aliases: ['/getir'], tag: 'Kurulum' },
      { id: 'matching', href: '/marketnext/matching', label: 'Ürün Eşleştirme', icon: 'mn-matching', aliases: ['/products', '/eslestirme-merkezi'] },
      { id: 'inbox', href: '/marketnext/matching/inbox', label: 'Gelen Kutusu', icon: 'inbox', badgeKey: 'inbox', aliases: ['/products/inbox'] },
      { id: 'mappings', href: '/marketnext/matching/mappings', label: 'Kanal Eşleşmeleri', icon: 'mappings', aliases: ['/products/mappings'] },
      { id: 'masters', href: '/marketnext/matching/masters', label: 'BenimPOS Ürünleri', icon: 'pool', aliases: ['/urun-havuzu'] },
      { id: 'sync', href: '/marketnext/sync', label: 'Stok & Fiyat', icon: 'mn-sync', tag: 'Yakında' },
      { id: 'profit', href: '/marketnext/profit', label: 'Kâr/Zarar Raporu', icon: 'profit' },
      { id: 'integrations', href: '/marketnext/integrations', label: 'Kanal Ayarları', icon: 'qc-integrations', aliases: ['/quick-commerce/integrations', '/ops/integrations'] },
      { id: 'picking', href: '/marketnext/picking', label: 'Toplama Kuyruğu', icon: 'qc-picking', aliases: ['/quick-commerce/picking', '/ops'] },
      { id: 'errors', href: '/marketnext/errors', label: 'Loglar / Hatalar', icon: 'qc-errors', aliases: ['/quick-commerce/errors'] },
      { id: 'health', href: '/marketnext/health', label: 'Sistem Sağlığı', icon: 'qc-health', aliases: ['/quick-commerce/health', '/ops/durum'] }
    ]
  },
  marketplace: {
    id: 'marketplace',
    label: 'Pazaryeri & Buybox',
    items: [
      { id: 'trendyol', href: '/marketplace/trendyol', label: 'Trendyol Pazaryeri', icon: 'trendyol', aliases: ['/komisyon-tarifesi', '/trendyol'] },
      { id: 'buybox', href: '/marketplace/buybox', label: 'Buybox Takibi', icon: 'buybox' },
      { id: 'profit', href: '/marketplace/profit', label: 'Fiyat ve Kâr', icon: 'profit' },
      { id: 'orders', href: '/marketplace/orders', label: 'Sipariş Kârlılığı', icon: 'orders', aliases: ['/siparisler'] },
      { id: 'products', href: '/marketplace/products', label: 'Ürün Ayarları', icon: 'products', aliases: ['/urunler'] },
      { id: 'shipping', href: '/marketplace/shipping', label: 'Kargo Maliyetleri', icon: 'shipping' }
    ]
  },
  ecommerce: {
    id: 'ecommerce',
    label: 'E-Ticaret',
    items: [
      { id: 'woocommerce', href: '/ecommerce/woocommerce', label: 'WooCommerce', icon: 'channel-woo', aliases: ['/woocommerce'] },
      { id: 'woocommerce-orders', href: '/ecommerce/woocommerce/orders', label: 'Siparişler', icon: 'orders' }
    ]
  },
  admin: {
    id: 'admin',
    label: 'Yönetim',
    items: [
      { id: 'branches', href: '/admin/branches', label: 'Şubeler', icon: 'branches', tag: 'Yakında' },
      { id: 'users', href: '/admin/users', label: 'Kullanıcılar', icon: 'users', tag: 'Yakında' },
      { id: 'status', href: '/admin/status', label: 'Sistem Durumu', icon: 'status' },
      { id: 'settings', href: '/admin/settings', label: 'Ayarlar', icon: 'settings', aliases: ['/ayarlar'] }
    ]
  }
};

/** Toplama/tablet modunda gösterilecek minimal MarketNext menü */
export const QC_PICKING_NAV_IDS = new Set(['picking', 'dashboard']);

export function listPanelModules() {
  return Object.values(PANEL_MODULES);
}

export function findNavItemByPath(pathname) {
  const path = normalizePath(pathname);
  for (const mod of listPanelModules()) {
    for (const item of mod.items) {
      if (normalizePath(item.href) === path) {
        return { module: mod, item };
      }
      for (const alias of item.aliases || []) {
        if (normalizePath(alias) === path) {
          return { module: mod, item, alias: true };
        }
      }
    }
  }
  return null;
}

export function resolveActiveNav(activeModule, activeItem) {
  const mod = PANEL_MODULES[activeModule];
  if (!mod) {
    return { module: PANEL_MODULES.marketnext, item: PANEL_MODULES.marketnext.items[0] };
  }
  const item = mod.items.find((i) => i.id === activeItem) || mod.items[0];
  return { module: mod, item };
}

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;
}

/** Eski URL → yeni canonical URL (query korunur) */
export const LEGACY_REDIRECTS = {
  '/eslestirme-merkezi': '/marketnext/matching',
  '/urun-havuzu': '/marketnext/matching/masters',
  '/trendyol': '/marketplace/trendyol',
  '/komisyon-tarifesi': null,
  '/siparisler': '/marketplace/orders',
  '/ayarlar': '/admin/settings',
  '/ops': '/marketnext/picking',
  '/ops/panel': '/marketnext',
  '/ops/integrations': '/marketnext/integrations',
  '/ops/durum': '/marketnext/health',
  '/urunler': '/marketplace/products',
  '/dashboard': '/marketnext',
  '/products': '/marketnext/matching/masters',
  '/products/inbox': '/marketnext/matching/inbox',
  '/products/mappings': '/marketnext/matching/mappings',
  '/products/data-quality': '/marketnext/matching/data-quality',
  '/kanal-maliyetleri': '/marketnext/matching/masters',
  '/products/costs': '/marketnext/matching/masters',
  '/quick-commerce': '/marketnext',
  '/quick-commerce/orders': '/marketnext/orders',
  '/quick-commerce/picking': '/marketnext/picking',
  '/quick-commerce/integrations': '/marketnext/integrations',
  '/quick-commerce/errors': '/marketnext/errors',
  '/quick-commerce/health': '/marketnext/health',
  '/getir': '/marketnext/orders/getir',
  '/uber-eats': '/marketnext/orders/uber-eats',
  '/yemeksepeti': '/marketnext/orders/yemeksepeti',
  '/woocommerce': '/ecommerce/woocommerce'
};

export function buildLegacyRedirect(pathname, searchParams) {
  const path = normalizePath(pathname);
  const trailing = pathname.endsWith('/') && path !== pathname ? '/' : '';
  const target = LEGACY_REDIRECTS[path];
  if (target === undefined) return null;
  if (target === null) return null;

  const qs = searchParams?.toString();
  return qs ? `${target}${trailing}?${qs}` : `${target}${trailing}`;
}
