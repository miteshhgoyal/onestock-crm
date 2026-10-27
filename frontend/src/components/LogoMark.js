export const LogoMark = ({ size = 34, className = "" }) => (
  <img
    src={`${process.env.PUBLIC_URL || ""}/icon (2).png`}
    width={size}
    height={size}
    className={`object-contain ${className}`}
    loading="eager"
    data-testid="brand-logo-mark"
    alt="Onestock Academy"
  />
);

export default LogoMark;
