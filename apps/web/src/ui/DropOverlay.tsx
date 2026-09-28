import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Only a drag that carries files is an import; dragging text or a link is left alone. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

/**
 * A CSV dropped anywhere on the window is imported (plan 08, decision 9). While a file is
 * dragged over the app the whole window says so; the drop hands the file on.
 *
 * `dragenter`/`dragleave` fire for every child crossed, so a counter — not a flag — says
 * whether the pointer is still inside the window.
 */
export function DropOverlay({ onDrop }: { readonly onDrop: (file: File) => void }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const depth = useRef(0);
  const latest = useRef(onDrop);
  useEffect(() => {
    latest.current = onDrop;
  });

  useEffect(() => {
    function enter(event: DragEvent): void {
      if (!carriesFiles(event)) {
        return;
      }
      depth.current += 1;
      setVisible(true);
    }
    function over(event: DragEvent): void {
      if (carriesFiles(event)) {
        // Without this the browser opens the file instead of letting it drop here.
        event.preventDefault();
      }
    }
    function leave(event: DragEvent): void {
      if (!carriesFiles(event)) {
        return;
      }
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) {
        setVisible(false);
      }
    }
    function drop(event: DragEvent): void {
      if (!carriesFiles(event)) {
        return;
      }
      depth.current = 0;
      setVisible(false);
      // A drop zone inside the page (the import dialog's own) already took this file;
      // handing it on again would upload it twice.
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) {
        latest.current(file);
      }
    }
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: (theme) => theme.zIndex.modal + 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'background.default',
        opacity: 0.94,
        border: '3px dashed',
        borderColor: 'primary.main',
        pointerEvents: 'none',
      }}
    >
      <Box sx={{ textAlign: 'center', color: 'primary.main' }}>
        <UploadFileRounded sx={{ fontSize: '3rem' }} aria-hidden />
        <Typography variant="h2" component="p">
          {t('common.import.dropHere')}
        </Typography>
      </Box>
    </Box>
  );
}
