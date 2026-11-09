import { navigate } from '../hooks/useLocation.js';

// A real <a href> (so open-in-new-tab, copy link and middle-click all work)
// that does client-side navigation on a plain left click.
export function Link({ href, onClick, ...props }) {
  const handleClick = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handleClick} {...props} />;
}
