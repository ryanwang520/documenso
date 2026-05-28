import React, { useEffect, useMemo, useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import type { DocumentData } from '@prisma/client';
import { Loader } from 'lucide-react';
import { type PDFDocumentProxy } from 'pdfjs-dist';
import { Document as PDFDocument, Page as PDFPage, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

import { PDF_VIEWER_PAGE_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
import { getFileSource } from '@documenso/lib/universal/upload/get-file';

import { cn } from '../lib/utils';
import { useToast } from './use-toast';

export type LoadedPDFDocument = PDFDocumentProxy;

/**
 * This imports the worker from the `pdfjs-dist` package.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url,
).toString();

// Only request the byte ranges we actually need (visible pages) so the worker
// never materialises the whole PDF in memory. Both flags are load-bearing:
// pdfjs documents that `disableAutoFetch` is a no-op while streaming is on —
// once a fetch stream is open the worker keeps consuming bytes until the file
// is fully read, regardless of auto-fetch. Setting `disableStream: true` switches
// pdfjs to XHR-based range requests, after which `disableAutoFetch: true` actually
// suppresses the background prefetch. Required for large PDFs in iOS Safari
// iframes (per-iframe heap cap ~250–384 MB).
// Kept at module scope: react-pdf re-fetches if `options` identity changes.
const PDF_DOCUMENT_OPTIONS = {
  disableAutoFetch: true,
  disableStream: true,
} as const;

// Cap the canvas device pixel ratio at 2x. iPhone Pro screens report 3, which
// produces a 9x canvas raster — easily hundreds of MB on a full-page render.
// 2x is visually indistinguishable for static signing content.
const PDF_DEVICE_PIXEL_RATIO =
  typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

export type OnPDFViewerPageClick = (_event: {
  pageNumber: number;
  numPages: number;
  originalEvent: React.MouseEvent<HTMLDivElement, MouseEvent>;
  pageHeight: number;
  pageWidth: number;
  pageX: number;
  pageY: number;
}) => void | Promise<void>;

const PDFLoader = () => (
  <>
    <Loader className="text-documenso h-12 w-12 animate-spin" />

    <p className="text-muted-foreground mt-4">
      <Trans>Loading document...</Trans>
    </p>
  </>
);

export type PDFViewerProps = {
  className?: string;
  documentData: DocumentData;
  onDocumentLoad?: (_doc: LoadedPDFDocument) => void;
  onPageClick?: OnPDFViewerPageClick;
  [key: string]: unknown;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onPageClick'>;

export const PDFViewer = ({
  className,
  documentData,
  onDocumentLoad,
  onPageClick,
  ...props
}: PDFViewerProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();

  const $el = useRef<HTMLDivElement>(null);

  const [isPdfSourceLoading, setIsPdfSourceLoading] = useState(false);
  const [pdfFile, setPdfFile] = useState<ArrayBuffer | { url: string } | null>(null);

  const [width, setWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [pdfError, setPdfError] = useState(false);

  const memoizedData = useMemo(
    () => ({ type: documentData.type, data: documentData.data }),
    [documentData.data, documentData.type],
  );

  const isLoading = isPdfSourceLoading || !pdfFile;

  const onDocumentLoaded = (doc: LoadedPDFDocument) => {
    setNumPages(doc.numPages);
    onDocumentLoad?.(doc);
  };

  const onDocumentPageClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>,
    pageNumber: number,
  ) => {
    const $el = event.target instanceof HTMLElement ? event.target : null;

    if (!$el) {
      return;
    }

    const $page = $el.closest(PDF_VIEWER_PAGE_SELECTOR);

    if (!$page) {
      return;
    }

    const { height, width, top, left } = $page.getBoundingClientRect();

    const pageX = event.clientX - left;
    const pageY = event.clientY - top;

    if (onPageClick) {
      void onPageClick({
        pageNumber,
        numPages,
        originalEvent: event,
        pageHeight: height,
        pageWidth: width,
        pageX,
        pageY,
      });
    }
  };

  useEffect(() => {
    if ($el.current) {
      const $current = $el.current;

      const { width } = $current.getBoundingClientRect();

      setWidth(width);

      const onResize = () => {
        const { width } = $current.getBoundingClientRect();

        setWidth(width);
      };

      window.addEventListener('resize', onResize);

      return () => {
        window.removeEventListener('resize', onResize);
      };
    }
  }, []);

  useEffect(() => {
    const fetchPdfSource = async () => {
      try {
        setIsPdfSourceLoading(true);

        const source = await getFileSource(memoizedData);

        // For S3-backed docs, hand pdfjs the URL so it can range-stream pages
        // on demand instead of materialising the whole file in memory. Inline
        // BYTES/BYTES_64 still go in as an ArrayBuffer since there's nothing
        // to stream.
        if (source.kind === 'url') {
          setPdfFile({ url: source.url });
        } else {
          setPdfFile(source.bytes.buffer);
        }

        setIsPdfSourceLoading(false);
      } catch (err) {
        console.error(err);

        toast({
          title: _(msg`Error`),
          description: _(msg`An error occurred while loading the document.`),
          variant: 'destructive',
        });
      }
    };

    void fetchPdfSource();
  }, [memoizedData, toast]);

  return (
    <div ref={$el} className={cn('overflow-hidden', className)} {...props}>
      {isLoading ? (
        <div
          className={cn(
            'flex h-[80vh] max-h-[60rem] w-full flex-col items-center justify-center overflow-hidden rounded',
          )}
        >
          <PDFLoader />
        </div>
      ) : (
        <>
          <PDFDocument
            file={pdfFile}
            options={PDF_DOCUMENT_OPTIONS}
            className={cn('w-full overflow-hidden rounded', {
              'h-[80vh] max-h-[60rem]': numPages === 0,
            })}
            onLoadSuccess={(d) => onDocumentLoaded(d)}
            // Uploading a invalid document causes an error which doesn't appear to be handled by the `error` prop.
            // Therefore we add some additional custom error handling.
            onSourceError={() => {
              setPdfError(true);
            }}
            externalLinkTarget="_blank"
            loading={
              <div className="dark:bg-background flex h-[80vh] max-h-[60rem] flex-col items-center justify-center bg-white/50">
                {pdfError ? (
                  <div className="text-muted-foreground text-center">
                    <p>
                      <Trans>Something went wrong while loading the document.</Trans>
                    </p>
                    <p className="mt-1 text-sm">
                      <Trans>Please try again or contact our support.</Trans>
                    </p>
                  </div>
                ) : (
                  <PDFLoader />
                )}
              </div>
            }
            error={
              <div className="dark:bg-background flex h-[80vh] max-h-[60rem] flex-col items-center justify-center bg-white/50">
                <div className="text-muted-foreground text-center">
                  <p>
                    <Trans>Something went wrong while loading the document.</Trans>
                  </p>
                  <p className="mt-1 text-sm">
                    <Trans>Please try again or contact our support.</Trans>
                  </p>
                </div>
              </div>
            }
          >
            {Array(numPages)
              .fill(null)
              .map((_, i) => (
                <div key={i} className="mb-1 last:-mb-2">
                  <div className="border-border overflow-hidden rounded border will-change-transform">
                    <PDFPage
                      pageNumber={i + 1}
                      width={width}
                      devicePixelRatio={PDF_DEVICE_PIXEL_RATIO}
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                      loading={() => ''}
                      onClick={(e) => onDocumentPageClick(e, i + 1)}
                    />
                  </div>
                  {/* <p className="text-muted-foreground/80 my-2 text-center text-[11px]">
                    <Trans>
                      Page {i + 1} of {numPages}
                    </Trans>
                  </p> */}
                </div>
              ))}
          </PDFDocument>
        </>
      )}
    </div>
  );
};

export default PDFViewer;
