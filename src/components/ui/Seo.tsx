import { Helmet } from 'react-helmet-async';
import type { PageMeta } from '../../utils/seo';
import { SITE_URL } from '../../utils/seo';

/**
 * Единая точка установки мета-тегов страницы: title, description, canonical,
 * Open Graph и Twitter Card. Рендерится на каждой странице через <Seo meta={...} />.
 */
export default function Seo({ meta }: { meta: PageMeta }) {
  const url = `${SITE_URL}${meta.path}`;
  return (
    <Helmet>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href={url} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      <meta property="og:url" content={url} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={meta.description} />
    </Helmet>
  );
}
