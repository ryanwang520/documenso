import React, { useLayoutEffect, useRef, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { FieldType } from '@prisma/client';
import { X } from 'lucide-react';

import { type TRecipientActionAuth } from '@documenso/lib/types/document-auth';
import { ZFieldMetaSchema } from '@documenso/lib/types/field-meta';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import { FieldRootContainer } from '@documenso/ui/components/field/field';
import { cn } from '@documenso/ui/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@documenso/ui/primitives/tooltip';

import { useRequiredDocumentSigningAuthContext } from './document-signing-auth-provider';

export type DocumentSigningFieldContainerProps = {
  field: FieldWithSignature;
  loading?: boolean;
  children: React.ReactNode;

  /**
   * A function that is called before the field requires to be signed, or reauthed.
   *
   * Example, you may want to show a dialog prior to signing where they can enter a value.
   *
   * Once that action is complete, you will need to call `executeActionAuthProcedure` to proceed
   * regardless if it requires reauth or not.
   *
   * If the function returns true, we will proceed with the signing process. Otherwise if
   * false is returned we will not proceed.
   */
  onPreSign?: () => Promise<boolean> | boolean;

  /**
   * The function required to be executed to insert the field.
   *
   * The auth values will be passed in if available.
   */
  onSign?: (documentAuthValue?: TRecipientActionAuth) => Promise<void> | void;
  onRemove?: (fieldType?: string) => Promise<void> | void;
  type?:
    | 'Date'
    | 'Initials'
    | 'Email'
    | 'Name'
    | 'Signature'
    | 'Text'
    | 'Radio'
    | 'Dropdown'
    | 'Number'
    | 'Checkbox';
  tooltipText?: string | null;
};

const RemoveTextWithResponsiveFontSize = () => {
  const [fontSize, setFontSize] = useState(0.875); // Default to text-sm (0.875rem)
  const textRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!textRef.current || !containerRef.current) {
      return;
    }

    const adjustTextSize = () => {
      const container = containerRef.current;
      const text = textRef.current;

      if (!container || !text) {
        return;
      }

      let size = 0.875; // Start with text-sm (0.875rem)
      text.style.fontSize = `${size}rem`;

      // Reduce font size until text fits the container
      while (
        (text.scrollWidth > container.clientWidth || text.scrollHeight > container.clientHeight) &&
        size > 0.2
      ) {
        size -= 0.05;
        text.style.fontSize = `${size}rem`;
      }

      setFontSize(size);
    };

    const resizeObserver = new ResizeObserver(adjustTextSize);
    resizeObserver.observe(containerRef.current);

    adjustTextSize();

    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center overflow-hidden"
    >
      <span ref={textRef} style={{ fontSize: `${fontSize}rem` }} className="whitespace-nowrap">
        <Trans>Remove</Trans>
      </span>
    </div>
  );
};

export const DocumentSigningFieldContainer = ({
  field,
  loading,
  onPreSign,
  onSign,
  onRemove,
  children,
  type,
  tooltipText,
}: DocumentSigningFieldContainerProps) => {
  const { executeActionAuthProcedure, isAuthRedirectRequired } =
    useRequiredDocumentSigningAuthContext();

  const parsedFieldMeta = field.fieldMeta ? ZFieldMetaSchema.parse(field.fieldMeta) : undefined;
  const readOnlyField = parsedFieldMeta?.readOnly || false;

  const handleInsertField = async () => {
    if (field.inserted || !onSign) {
      return;
    }

    // Bypass reauth for non signature fields.
    if (field.type !== FieldType.SIGNATURE) {
      const presignResult = await onPreSign?.();

      if (presignResult === false) {
        return;
      }

      await onSign();
      return;
    }

    if (isAuthRedirectRequired) {
      await executeActionAuthProcedure({
        onReauthFormSubmit: () => {
          // Do nothing since the user should be redirected.
        },
        actionTarget: field.type,
      });

      return;
    }

    // Handle any presign requirements, and halt if required.
    if (onPreSign) {
      const preSignResult = await onPreSign();

      if (preSignResult === false) {
        return;
      }
    }

    await executeActionAuthProcedure({
      onReauthFormSubmit: onSign,
      actionTarget: field.type,
    });
  };

  const onRemoveSignedFieldClick = async () => {
    if (!field.inserted) {
      return;
    }

    await onRemove?.();
  };

  const onClearCheckBoxValues = async (fieldType?: string) => {
    if (!field.inserted) {
      return;
    }

    await onRemove?.(fieldType);
  };

  return (
    <div className={cn('[container-type:size]', { group: type === 'Checkbox' })}>
      <FieldRootContainer field={field}>
        {!field.inserted && !loading && !readOnlyField && (
          <button
            type="submit"
            className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ width: 'max(100%, 44px)', height: 'max(100%, 44px)' }}
            onClick={async () => handleInsertField()}
          />
        )}

        {readOnlyField && (
          <button className="bg-background/40 absolute inset-0 z-10 flex h-full w-full items-center justify-center rounded-md text-sm opacity-0 duration-200 group-hover:opacity-100">
            <span className="bg-foreground/50 dark:bg-background/50 text-background dark:text-foreground rounded-xl p-2">
              <Trans>Read only field</Trans>
            </span>
          </button>
        )}
        {type === 'Date' && field.inserted && !loading && !readOnlyField && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                className="text-destructive bg-background/40 absolute inset-0 z-10 flex h-full w-full items-center justify-center rounded-md text-sm opacity-0 duration-200 group-hover:opacity-100"
                onClick={onRemoveSignedFieldClick}
              >
                <Trans>Remove</Trans>
              </button>
            </TooltipTrigger>

            {tooltipText && <TooltipContent className="max-w-xs">{tooltipText}</TooltipContent>}
          </Tooltip>
        )}

        {type === 'Checkbox' && field.inserted && !loading && !readOnlyField && (
          <button
            className="dark:bg-background absolute -bottom-10 flex items-center justify-evenly rounded-md border bg-gray-900 opacity-0 group-hover:opacity-100"
            onClick={() => void onClearCheckBoxValues(type)}
          >
            <span className="dark:text-muted-foreground/50 dark:hover:text-muted-foreground dark:hover:bg-foreground/10 rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100">
              <X className="h-4 w-4" />
            </span>
          </button>
        )}

        {/* For signature fields, provide a click handler but no visible "Remove" text */}
        {type === 'Signature' && field.inserted && !loading && !readOnlyField && (
          <button
            className="absolute inset-0 z-10 h-full w-full"
            onClick={onRemoveSignedFieldClick}
          />
        )}

        {/* For other fields (not Date, Checkbox, or Signature), show the "Remove" text on hover */}
        {type !== 'Date' &&
          type !== 'Checkbox' &&
          type !== 'Signature' &&
          field.inserted &&
          !loading &&
          !readOnlyField && (
            <button
              className="text-destructive bg-background/50 absolute inset-0 z-10 flex h-full w-full items-center justify-center rounded-md opacity-0 duration-200 group-hover:opacity-100"
              onClick={onRemoveSignedFieldClick}
            >
              <RemoveTextWithResponsiveFontSize />
            </button>
          )}

        {(field.type === FieldType.RADIO || field.type === FieldType.CHECKBOX) &&
          field.fieldMeta?.label && (
            <div
              className={cn(
                'absolute -top-16 left-0 right-0 rounded-md p-2 text-center text-xs text-gray-700',
                {
                  'bg-foreground/5 border-border border': !field.inserted,
                },
                {
                  'bg-documenso-200 border-primary border': field.inserted,
                },
              )}
            >
              {field.fieldMeta.label}
            </div>
          )}

        {children}
      </FieldRootContainer>
    </div>
  );
};
