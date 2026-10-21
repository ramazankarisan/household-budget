import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

function CrashNotice({ onRetry }: { readonly onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert
      severity="error"
      action={
        <Button color="inherit" size="small" onClick={onRetry}>
          {t('errors.crash.retry')}
        </Button>
      }
    >
      {t('errors.crash.message')}
    </Alert>
  );
}

interface BoundaryProps {
  readonly children: ReactNode;
}

class Boundary extends Component<BoundaryProps, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The console is the only log a local app has; the stack is what a bug report needs.
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <CrashNotice
          onRetry={() => {
            this.setState({ failed: false });
          }}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * A page that throws while rendering takes only itself down: the shell, its navigation and
 * the import button stay, and the alert offers to try again. Keyed by the path, so going to
 * another page is a fresh start rather than the same alert.
 */
export function PageErrorBoundary({ children }: BoundaryProps) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}
