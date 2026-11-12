import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DOC_PAGES } from '@/features/docs/docs.generated';
import { findPage } from '@/features/docs/docs';
import { DocPageView } from '@/features/docs/DocPageView';

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = findPage((await params).slug);
  return page ? { title: `${page.title} · Docs`, description: page.description } : {};
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const page = findPage((await params).slug);
  if (!page) notFound();
  return <DocPageView page={page} />;
}
