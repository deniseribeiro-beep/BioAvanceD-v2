import { ReactNode, CSSProperties } from 'react';
import './Card.css';

interface CardProps {
  children: ReactNode;
  title?: string;
  className?: string;
  onClick?: () => void;
  style?: CSSProperties;
}

export default function Card({ children, title, className = '', onClick, style }: CardProps) {
  return (
    <div className={`card ${className}`} onClick={onClick} style={style}>
      {title && <div className="card-header"><h2 className="card-title">{title}</h2></div>}
      <div className="card-body">{children}</div>
    </div>
  );
}


