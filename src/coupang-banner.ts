const COUPANG_SCRIPT_SRC = 'https://ads-partners.coupang.com/g.js';

type CoupangBannerOptions = {
  id: number;
  template: string;
  trackingCode: string;
  width: string;
  height: string;
  tsource: string;
  container: HTMLElement;
};

declare global {
  interface Window {
    PartnersCoupang?: {
      G: new (options: CoupangBannerOptions) => unknown;
    };
  }
}

const container = document.getElementById('coupang-banner');

if (container) {
  const renderBanner = () => {
    if (!window.PartnersCoupang?.G || container.childElementCount > 0) return;

    new window.PartnersCoupang.G({
      id: 1012565,
      template: 'carousel',
      trackingCode: 'AF3697600',
      width: '680',
      height: '140',
      tsource: '',
      container,
    });
  };

  const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${COUPANG_SCRIPT_SRC}"]`);

  if (existingScript) {
    if (window.PartnersCoupang?.G) renderBanner();
    else existingScript.addEventListener('load', renderBanner, { once: true });
  } else {
    const script = document.createElement('script');
    script.src = COUPANG_SCRIPT_SRC;
    script.async = true;
    script.addEventListener('load', renderBanner, { once: true });
    document.head.appendChild(script);
  }
}

export {};
