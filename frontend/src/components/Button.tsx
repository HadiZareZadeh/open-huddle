import { ButtonHTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, children, ...props }, ref) => {
    const variants = {
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      danger: 'btn-danger',
    };

    return (
      <button ref={ref} className={clsx(variants[variant], className)} {...props}>
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
