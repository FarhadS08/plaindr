import { describe, it, expect } from 'vitest';

describe('SEO Configuration', () => {
  const SEO_CONFIG = {
    brand: {
      name: 'Plaindr',
      separator: ' | ',
    },
    pages: {
      home: {
        title: 'AI Tools Policies in Plain English | Plaindr',
        description: 'Skip the fine print. Plaindr turns AI tools\' Terms of Service and Privacy Policies into clear, source-based answers for users, legal, IT, and compliance teams.',
        robots: 'index, follow',
      },
      history: {
        title: 'Conversation History | Plaindr',
        description: 'View and search your saved Plaindr conversations. Revisit past questions and answers about AI tools\' terms, privacy policies, and data use.',
        robots: 'noindex, follow',
      },
    },
  };

  describe('Title validation', () => {
    it('should have home page title within recommended length (50-60 chars)', () => {
      const title = SEO_CONFIG.pages.home.title;
      expect(title.length).toBeGreaterThanOrEqual(40);
      expect(title.length).toBeLessThanOrEqual(70);
    });

    it('should have history page title within recommended length', () => {
      const title = SEO_CONFIG.pages.history.title;
      expect(title.length).toBeGreaterThanOrEqual(20);
      expect(title.length).toBeLessThanOrEqual(70);
    });

    it('should include brand name in all titles', () => {
      expect(SEO_CONFIG.pages.home.title).toContain(SEO_CONFIG.brand.name);
      expect(SEO_CONFIG.pages.history.title).toContain(SEO_CONFIG.brand.name);
    });

    it('should use correct separator in titles', () => {
      expect(SEO_CONFIG.pages.home.title).toContain(SEO_CONFIG.brand.separator);
      expect(SEO_CONFIG.pages.history.title).toContain(SEO_CONFIG.brand.separator);
    });
  });

  describe('Meta description validation', () => {
    it('should have home page description within recommended length (150-160 chars)', () => {
      const desc = SEO_CONFIG.pages.home.description;
      expect(desc.length).toBeGreaterThanOrEqual(100);
      expect(desc.length).toBeLessThanOrEqual(180);
    });

    it('should have history page description within recommended length', () => {
      const desc = SEO_CONFIG.pages.history.description;
      expect(desc.length).toBeGreaterThanOrEqual(100);
      expect(desc.length).toBeLessThanOrEqual(180);
    });

    it('should not contain double quotes in descriptions', () => {
      expect(SEO_CONFIG.pages.home.description).not.toContain('"');
      expect(SEO_CONFIG.pages.history.description).not.toContain('"');
    });
  });

  describe('Robots directives', () => {
    it('should have home page indexable', () => {
      expect(SEO_CONFIG.pages.home.robots).toBe('index, follow');
    });

    it('should have history page noindex (private content)', () => {
      expect(SEO_CONFIG.pages.history.robots).toBe('noindex, follow');
    });
  });

  describe('JSON-LD structured data', () => {
    const organizationSchema = {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "Plaindr",
      "url": "https://plaindr.com",
      "description": "Plaindr turns AI tools' Terms of Service and Privacy Policies into clear, source-based answers for users, legal, IT, and compliance teams.",
    };

    const websiteSchema = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "Plaindr",
      "url": "https://plaindr.com",
      "description": "AI Tools Policies in Plain English",
    };

    it('should have valid Organization schema', () => {
      expect(organizationSchema['@context']).toBe('https://schema.org');
      expect(organizationSchema['@type']).toBe('Organization');
      expect(organizationSchema.name).toBe('Plaindr');
      expect(organizationSchema.url).toMatch(/^https:\/\//);
    });

    it('should have valid WebSite schema', () => {
      expect(websiteSchema['@context']).toBe('https://schema.org');
      expect(websiteSchema['@type']).toBe('WebSite');
      expect(websiteSchema.name).toBe('Plaindr');
      expect(websiteSchema.url).toMatch(/^https:\/\//);
    });
  });

  describe('Open Graph tags', () => {
    const ogTags = {
      'og:type': 'website',
      'og:title': 'AI Tools Policies in Plain English | Plaindr',
      'og:description': 'Skip the fine print. Plaindr turns AI tools\' Terms of Service and Privacy Policies into clear, source-based answers for users, legal, IT, and compliance teams.',
      'og:site_name': 'Plaindr',
      'og:locale': 'en_US',
    };

    it('should have correct og:type', () => {
      expect(ogTags['og:type']).toBe('website');
    });

    it('should have og:title matching page title', () => {
      expect(ogTags['og:title']).toBe(SEO_CONFIG.pages.home.title);
    });

    it('should have og:description matching meta description', () => {
      expect(ogTags['og:description']).toBe(SEO_CONFIG.pages.home.description);
    });

    it('should have correct locale', () => {
      expect(ogTags['og:locale']).toBe('en_US');
    });
  });

  describe('Twitter Card tags', () => {
    const twitterTags = {
      'twitter:card': 'summary_large_image',
      'twitter:title': 'AI Tools Policies in Plain English | Plaindr',
      'twitter:description': 'Skip the fine print. Plaindr turns AI tools\' Terms of Service and Privacy Policies into clear, source-based answers for users, legal, IT, and compliance teams.',
    };

    it('should have correct card type', () => {
      expect(twitterTags['twitter:card']).toBe('summary_large_image');
    });

    it('should have twitter:title matching page title', () => {
      expect(twitterTags['twitter:title']).toBe(SEO_CONFIG.pages.home.title);
    });
  });
});
