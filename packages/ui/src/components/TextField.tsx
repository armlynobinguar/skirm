'use client';
import * as React from 'react';
import { ICONS } from '../data';
import type { IconName } from '../types';
import { cx } from '../util';
import { Icon } from './Icon';

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  hint?: string;
  error?: string;
  /** An Icon name or a node shown before the value. */
  prefix?: IconName | React.ReactNode;
  /** A unit such as "NEAR" or "%". */
  suffix?: React.ReactNode;
  multiline?: boolean;
  mono?: boolean;
}

export function TextField({
  label,
  hint,
  error,
  prefix,
  suffix,
  multiline,
  mono,
  className,
  id: idProp,
  ...rest
}: TextFieldProps): React.ReactElement {
  const autoId = React.useId();
  const id = idProp ?? 'sk-field-' + autoId.replace(/:/g, '');
  const descId = hint || error ? id + '-desc' : undefined;
  const common = {
    id,
    className: cx('sk-input', mono && 'is-mono'),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': descId,
  };
  const prefixNode =
    typeof prefix === 'string' && prefix in ICONS ? <Icon name={prefix as IconName} /> : (prefix as React.ReactNode);
  return (
    <div className={cx('sk-field', error && 'is-error', rest.disabled && 'is-disabled', className)}>
      {label ? (
        <label className="sk-field-label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className={cx('sk-input-wrap', multiline && 'is-multi')}>
        {prefix ? <span className="sk-input-affix">{prefixNode}</span> : null}
        {multiline ? (
          <textarea {...(rest as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} {...common} />
        ) : (
          <input {...rest} {...common} />
        )}
        {suffix ? <span className="sk-input-affix">{suffix}</span> : null}
      </div>
      {error ? (
        <div className="sk-field-msg is-error" id={descId}>
          <Icon name="critical" size={14} />
          <span>{error}</span>
        </div>
      ) : hint ? (
        <div className="sk-field-msg" id={descId}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
