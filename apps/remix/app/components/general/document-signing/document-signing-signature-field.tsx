import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { Loader } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useRevalidator } from 'react-router';

import { useIsMobile } from '@documenso/lib/client-only/hooks/use-is-mobile';
import { DO_NOT_INVALIDATE_QUERY_ON_MUTATION } from '@documenso/lib/constants/trpc';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { TRecipientActionAuth } from '@documenso/lib/types/document-auth';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import { trpc } from '@documenso/trpc/react';
import type {
  TRemovedSignedFieldWithTokenMutationSchema,
  TSignFieldWithTokenMutationSchema,
} from '@documenso/trpc/server/field-router/schema';
import { Button } from '@documenso/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@documenso/ui/primitives/dialog';
import { Sheet, SheetContent } from '@documenso/ui/primitives/sheet';
import { SignaturePad } from '@documenso/ui/primitives/signature-pad';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { DocumentSigningDisclosure } from '~/components/general/document-signing/document-signing-disclosure';

import { useRequiredDocumentSigningAuthContext } from './document-signing-auth-provider';
import { DocumentSigningFieldContainer } from './document-signing-field-container';
import { useRequiredDocumentSigningContext } from './document-signing-provider';
import { useDocumentSigningRecipientContext } from './document-signing-recipient-provider';

type SignatureFieldState = 'empty' | 'signed-image' | 'signed-text';

export type DocumentSigningSignatureFieldProps = {
  field: FieldWithSignature;
  onSignField?: (value: TSignFieldWithTokenMutationSchema) => Promise<void> | void;
  onUnsignField?: (value: TRemovedSignedFieldWithTokenMutationSchema) => Promise<void> | void;
  typedSignatureEnabled?: boolean;
  uploadSignatureEnabled?: boolean;
  drawSignatureEnabled?: boolean;
};

export const DocumentSigningSignatureField = ({
  field,
  onSignField,
  onUnsignField,
  typedSignatureEnabled,
  uploadSignatureEnabled,
  drawSignatureEnabled,
}: DocumentSigningSignatureFieldProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const { revalidate } = useRevalidator();

  const { recipient } = useDocumentSigningRecipientContext();

  const signatureRef = useRef<HTMLParagraphElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLParagraphElement>(null);
  const placeholderContainerRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(2);
  const [placeholderFontSize, setPlaceholderFontSize] = useState(2);

  const { signature: providedSignature, setSignature: setProvidedSignature } =
    useRequiredDocumentSigningContext();

  const { executeActionAuthProcedure } = useRequiredDocumentSigningAuthContext();

  const { mutateAsync: signFieldWithToken, isPending: isSignFieldWithTokenLoading } =
    trpc.field.signFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const {
    mutateAsync: removeSignedFieldWithToken,
    isPending: isRemoveSignedFieldWithTokenLoading,
  } = trpc.field.removeSignedFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const { signature } = field;

  const [isSigning, setIsSigning] = useState(false);

  const isLoading = isSignFieldWithTokenLoading || isRemoveSignedFieldWithTokenLoading || isSigning;

  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [showSignatureOptionsPopover, setShowSignatureOptionsPopover] = useState(false);
  const [showSignatureOptionsSheet, setShowSignatureOptionsSheet] = useState(false);
  const [showSignatureBottomSheet, setShowSignatureBottomSheet] = useState(false);
  const isMobile = useIsMobile();

  // Handle click outside to dismiss the popup
  useEffect(() => {
    if (!showSignatureOptionsPopover) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(event.target as Node)) {
        setShowSignatureOptionsPopover(false);
      }
    };

    // Add the event listener
    document.addEventListener('mousedown', handleClickOutside);

    // Clean up
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSignatureOptionsPopover]);

  const [localSignature, setLocalSignature] = useState<string | null>(null);

  const state = useMemo<SignatureFieldState>(() => {
    if (!field.inserted) {
      return 'empty';
    }

    if (signature?.signatureImageAsBase64) {
      return 'signed-image';
    }

    return 'signed-text';
  }, [field.inserted, signature?.signatureImageAsBase64]);

  // only set isSigning to false when the field signature is changed
  useEffect(() => {
    setIsSigning(false);
  }, [signature?.id]);

  const onPreSign = () => {
    // If the field is not inserted (empty) but we already have a signature from another field
    // don't show the modal and directly apply the existing signature
    if (!field.inserted && providedSignature) {
      // We already have a signature from another field, so apply it directly
      return true;
    }

    // Show the signature modal if this is the first field being signed
    // or if the existing signature was cleared
    if (!field.inserted || !providedSignature) {
      if (isMobile) {
        setShowSignatureBottomSheet(true);
      } else {
        setShowSignatureModal(true);
      }
      return false;
    }

    return true;
  };
  /**
   * When the user clicks the sign button in the dialog where they enter their signature.
   */
  const onDialogSignClick = () => {
    setShowSignatureModal(false);
    setShowSignatureBottomSheet(false);

    if (!localSignature) {
      return;
    }

    // Store the signature value to use after authentication
    setProvidedSignature(localSignature);

    void executeActionAuthProcedure({
      onReauthFormSubmit: async (authOptions) => await onSign(authOptions, localSignature),
      actionTarget: field.type,
    });
  };

  const onSign = async (authOptions?: TRecipientActionAuth, signature?: string) => {
    try {
      const value = signature || providedSignature;

      if (!value) {
        setShowSignatureModal(true);
        return;
      }

      // If the field already has a signature, remove it first
      if (field.inserted) {
        const removePayload: TRemovedSignedFieldWithTokenMutationSchema = {
          token: recipient.token,
          fieldId: field.id,
        };

        if (onUnsignField) {
          await onUnsignField(removePayload);
        } else {
          await removeSignedFieldWithToken(removePayload);
        }
      }

      const isTypedSignature = !value.startsWith('data:image');

      if (isTypedSignature && typedSignatureEnabled === false) {
        toast({
          title: _(msg`Error`),
          description: _(msg`Typed signatures are not allowed. Please draw your signature.`),
          variant: 'destructive',
        });

        return;
      }

      const payload: TSignFieldWithTokenMutationSchema = {
        token: recipient.token,
        fieldId: field.id,
        value,
        isBase64: !isTypedSignature,
        authOptions,
      };

      if (onSignField) {
        await onSignField(payload);
      } else {
        setIsSigning(true);
        await signFieldWithToken(payload);
      }

      await revalidate();
    } catch (err) {
      const error = AppError.parseError(err);

      if (error.code === AppErrorCode.UNAUTHORIZED) {
        throw error;
      }

      console.error(err);
      setIsSigning(false);

      toast({
        title: _(msg`Error`),
        description: _(msg`An error occurred while signing the document.`),
        variant: 'destructive',
      });
    }
  };

  // This shows the options popover/sheet when an already signed field is clicked
  const onSignedFieldClick = () => {
    if (isMobile) {
      setShowSignatureOptionsSheet(true);
    } else {
      setShowSignatureOptionsPopover(true);
    }
  };

  // Handle the "Change" button click in the options popover/sheet
  const onChangeSignature = () => {
    // Close both popover and sheet regardless of which one is open
    setShowSignatureOptionsPopover(false);
    setShowSignatureOptionsSheet(false);

    // Clear any existing signature data to start fresh
    setLocalSignature(null);

    // Show the appropriate modal based on device type
    if (isMobile) {
      setShowSignatureBottomSheet(true);
    } else {
      setShowSignatureModal(true);
    }
  };

  const onRemove = async () => {
    try {
      // Close both popover and sheet regardless of which one is open
      setShowSignatureOptionsPopover(false);
      setShowSignatureOptionsSheet(false);

      // We're only clearing localSignature but preserving providedSignature
      // so it can be automatically reapplied when signing again
      setLocalSignature(null);

      const payload: TRemovedSignedFieldWithTokenMutationSchema = {
        token: recipient.token,
        fieldId: field.id,
      };

      if (onUnsignField) {
        await onUnsignField(payload);
        return;
      } else {
        await removeSignedFieldWithToken(payload);
      }

      await revalidate();
      // 添加一个短暂延迟，确保DOM已更新
      setTimeout(() => {
        adjustPlaceholderSize();
      }, 50);
    } catch (err) {
      console.error(err);

      toast({
        title: _(msg`Error`),
        description: _(msg`An error occurred while removing the signature.`),
        variant: 'destructive',
      });
    }
  };

  useLayoutEffect(() => {
    if (!signatureRef.current || !containerRef.current || !signature?.typedSignature) {
      return;
    }

    const adjustTextSize = () => {
      const container = containerRef.current;
      const text = signatureRef.current;

      if (!container || !text) {
        return;
      }

      let size = 2;
      text.style.fontSize = `${size}rem`;

      while (
        (text.scrollWidth > container.clientWidth || text.scrollHeight > container.clientHeight) &&
        size > 0.8
      ) {
        size -= 0.1;
        text.style.fontSize = `${size}rem`;
      }

      setFontSize(size);
    };

    const resizeObserver = new ResizeObserver(adjustTextSize);
    resizeObserver.observe(containerRef.current);

    adjustTextSize();

    return () => resizeObserver.disconnect();
  }, [signature?.typedSignature]);
  const adjustPlaceholderSize = () => {
    const container = placeholderContainerRef.current;
    const text = placeholderRef.current;

    if (!container || !text) {
      return;
    }

    let size = 2;
    text.style.fontSize = `${size}rem`;

    while (
      (text.scrollWidth > container.clientWidth || text.scrollHeight > container.clientHeight) &&
      size > 0.8
    ) {
      size -= 0.1;
      text.style.fontSize = `${size}rem`;
    }

    setPlaceholderFontSize(size);
  };

  // Adjust placeholder text size to fit container
  useLayoutEffect(() => {
    if (!placeholderRef.current || !placeholderContainerRef.current || state !== 'empty') {
      return;
    }

    const resizeObserver = new ResizeObserver(adjustPlaceholderSize);
    resizeObserver.observe(placeholderContainerRef.current);

    adjustPlaceholderSize();

    return () => resizeObserver.disconnect();
  }, [state]);

  // Position the popup relative to the field element
  useLayoutEffect(() => {
    if (!isMobile && showSignatureOptionsPopover && optionsRef.current && fieldRef.current) {
      const fieldRect = fieldRef.current.getBoundingClientRect();

      // Position the popup above the field
      optionsRef.current.style.left = `${fieldRect.left + fieldRect.width / 2}px`;
      optionsRef.current.style.top = `${fieldRect.top - 60}px`; // 10px above the field
      optionsRef.current.style.transform = 'translate(-50%, -100%)';
    }
  }, [isMobile, showSignatureOptionsPopover]);

  return (
    <DocumentSigningFieldContainer
      field={field}
      onPreSign={onPreSign}
      onSign={onSign}
      onRemove={onSignedFieldClick}
      type="Signature"
    >
      {isLoading && (
        <div className="bg-background absolute inset-0 flex items-center justify-center rounded-md">
          <Loader className="text-primary h-5 w-5 animate-spin md:h-8 md:w-8" />
        </div>
      )}

      {state === 'empty' && (
        <div
          ref={placeholderContainerRef}
          className="flex h-full w-full items-center justify-center p-2"
        >
          <p
            ref={placeholderRef}
            className="group-hover:text-primary font-signature text-muted-foreground w-full overflow-hidden text-center leading-tight duration-200 group-hover:text-yellow-300"
            style={{ fontSize: `${placeholderFontSize}rem` }}
          >
            <Trans>Signature</Trans>
          </p>
        </div>
      )}

      {state === 'signed-image' && signature?.signatureImageAsBase64 && (
        <img
          src={signature.signatureImageAsBase64}
          alt={`Signature for ${recipient.name}`}
          className="h-full w-full object-contain"
        />
      )}

      {state === 'signed-text' && (
        <div ref={containerRef} className="flex h-full w-full items-center justify-center p-2">
          <p
            ref={signatureRef}
            className="font-signature text-muted-foreground dark:text-background w-full overflow-hidden break-all text-center leading-tight duration-200"
            style={{ fontSize: `${fontSize}rem` }}
          >
            {signature?.typedSignature}
          </p>
        </div>
      )}

      {/* Desktop: Signature Options Popover - shows above the signature field */}
      <div ref={fieldRef} className="relative">
        {!isMobile &&
          showSignatureOptionsPopover &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={optionsRef}
              className="fixed min-w-[120px] rounded-md border border-dashed border-blue-200 bg-white p-0 shadow-md"
              style={{
                // Position will be calculated dynamically
                zIndex: 9999,
              }}
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  className="px-6 py-3 text-center transition-colors hover:bg-gray-50"
                  onClick={onChangeSignature}
                >
                  <span className="text-foreground">Change</span>
                </button>

                <div className="border-t border-gray-200"></div>

                <button
                  type="button"
                  className="px-6 py-3 text-center transition-colors hover:bg-gray-50"
                  onClick={async () => await onRemove()}
                >
                  <span className="text-destructive">Clear</span>
                </button>
              </div>
            </div>,
            document.body,
          )}
      </div>

      {/* Mobile: Signature Options Sheet - slides up from bottom */}
      <Sheet
        open={isMobile && showSignatureOptionsSheet}
        onOpenChange={setShowSignatureOptionsSheet}
      >
        <SheetContent position="bottom" size="sm" className="p-0 pb-0 [&>button]:hidden">
          <div className="flex flex-col">
            <button
              type="button"
              className="py-4 text-center text-base transition-colors hover:bg-gray-50"
              onClick={onChangeSignature}
            >
              <span className="text-foreground">Change</span>
            </button>

            <div className="border-t border-gray-200"></div>

            <button
              type="button"
              className="py-4 text-center text-base transition-colors hover:bg-gray-50"
              onClick={async () => await onRemove()}
            >
              <span className="text-destructive">Clear</span>
            </button>

            <div className="border-t border-gray-200"></div>

            <button
              type="button"
              className="py-4 text-center text-base transition-colors hover:bg-gray-50"
              onClick={() => setShowSignatureOptionsSheet(false)}
            >
              <span className="text-foreground">Cancel</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Signature Input Dialog (Desktop) */}
      <Dialog open={showSignatureModal} onOpenChange={setShowSignatureModal}>
        <DialogContent>
          <DialogTitle>
            <Trans>
              Sign as {recipient.name}{' '}
              <div className="text-muted-foreground h-5">({recipient.email})</div>
            </Trans>
          </DialogTitle>

          <SignaturePad
            className="mt-2"
            value={localSignature ?? ''}
            onChange={({ value }) => setLocalSignature(value)}
            typedSignatureEnabled={typedSignatureEnabled}
            uploadSignatureEnabled={false}
            drawSignatureEnabled={drawSignatureEnabled}
          />

          <DocumentSigningDisclosure />

          <DialogFooter>
            <div className="flex w-full flex-1 flex-nowrap gap-4">
              <Button
                type="button"
                className="dark:bg-muted dark:hover:bg-muted/80 flex-1 bg-black/5 hover:bg-black/10"
                variant="secondary"
                onClick={() => {
                  setShowSignatureModal(false);
                  setLocalSignature(null);
                }}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={!localSignature}
                onClick={() => onDialogSignClick()}
              >
                <Trans>Sign</Trans>
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signature Input Sheet (Mobile) */}
      <Sheet open={showSignatureBottomSheet} onOpenChange={setShowSignatureBottomSheet}>
        <SheetContent
          position="bottom"
          size="content"
          className="flex max-h-[100dvh] flex-col gap-0 overflow-hidden p-0 pt-4 [&>button]:hidden"
        >
          <div className="px-4 pb-2">
            <h2 className="text-xl font-semibold">
              <Trans>Sign as {recipient.name}</Trans>
            </h2>
            <p className="text-muted-foreground text-sm">{recipient.email}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
            <SignaturePad
              className="mt-2"
              value={localSignature ?? ''}
              onChange={({ value }) => setLocalSignature(value)}
              typedSignatureEnabled={typedSignatureEnabled}
              uploadSignatureEnabled={false}
              drawSignatureEnabled={drawSignatureEnabled}
            />

            <DocumentSigningDisclosure className="mt-4" />
          </div>

          <div className="flex space-x-2 border-t border-gray-200 px-4 pb-4 pt-3">
            <Button
              type="button"
              className="w-full"
              disabled={!localSignature}
              onClick={() => onDialogSignClick()}
            >
              <Trans>Sign</Trans>
            </Button>
            <Button
              type="button"
              className="w-full"
              variant="secondary"
              onClick={() => {
                setShowSignatureBottomSheet(false);
                setLocalSignature(null);
              }}
            >
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </DocumentSigningFieldContainer>
  );
};
