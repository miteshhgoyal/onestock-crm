export default function PanelSurface({ className = "", children, ...props }) {
  return (
    <div {...props} className={className}>
      {children}
    </div>
  );
}
