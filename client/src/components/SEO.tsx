import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description: string;
  robots?: string;
  canonical?: string;
  ogType?: string;
  ogImage?: string;
}

/**
 * SEO Component - Updates document head with page-specific meta tags
 * 
 * Usage:
 * <SEO 
 *   title="Page Title | Plaindr"
 *   description="Page description for search engines"
 *   robots="index, follow"
 * />
 */
export function SEO({
  title,
  description,
  robots = 'index, follow',
  canonical,
  ogType = 'website',
  ogImage = '/og-image.png',
}: SEOProps) {
  useEffect(() => {
    // Update document title
    document.title = title;

    // Helper to update or create meta tag
    const updateMetaTag = (name: string, content: string, isProperty = false) => {
      const attribute = isProperty ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attribute}="${name}"]`) as HTMLMetaElement;
      
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attribute, name);
        document.head.appendChild(meta);
      }
      meta.content = content;
    };

    // Update primary meta tags
    updateMetaTag('title', title);
    updateMetaTag('description', description);
    updateMetaTag('robots', robots);

    // Update Open Graph tags
    updateMetaTag('og:title', title, true);
    updateMetaTag('og:description', description, true);
    updateMetaTag('og:type', ogType, true);
    updateMetaTag('og:image', ogImage, true);

    // Update Twitter Card tags
    updateMetaTag('twitter:title', title);
    updateMetaTag('twitter:description', description);
    updateMetaTag('twitter:image', ogImage);

    // Update canonical URL if provided
    if (canonical) {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
      }
      link.href = canonical;
    }

    // Cleanup function to reset title on unmount (optional)
    return () => {
      // Keep the last title set - no cleanup needed
    };
  }, [title, description, robots, canonical, ogType, ogImage]);

  return null; // This component doesn't render anything
}

// SEO configuration based on the provided JSON config
export const SEO_CONFIG = {
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
} as const;

export default SEO;
