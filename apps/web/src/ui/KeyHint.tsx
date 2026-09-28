import Box from '@mui/material/Box';

/** A keyboard shortcut shown next to the control it triggers (DESIGN.md §5). */
export function KeyHint({ keys }: { readonly keys: string }) {
  return (
    <Box
      component="kbd"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 20,
        height: 20,
        px: 0.625,
        boxSizing: 'border-box',
        border: '1px solid',
        borderColor: 'divider',
        borderBottomWidth: 2,
        borderRadius: 1,
        backgroundColor: 'background.paper',
        color: 'text.secondary',
        typography: 'caption',
        lineHeight: 1,
      }}
    >
      {keys}
    </Box>
  );
}
