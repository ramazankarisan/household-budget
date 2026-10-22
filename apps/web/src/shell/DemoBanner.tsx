import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import { useTranslation } from 'react-i18next';

const REPOSITORY = 'https://github.com/ramazankarisan/household-budget#run-it-locally';

/**
 * What the hosted demo says on every page (plan 12): the data is made up and a reload
 * forgets every change. Rendered only in `--mode demo`; the real app's build drops it.
 */
export function DemoBanner() {
  const { t } = useTranslation();
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      <strong>{t('common.demo.label')}:</strong> {t('common.demo.text')}{' '}
      <Link href={REPOSITORY}>{t('common.demo.link')}</Link>
    </Alert>
  );
}
