import { useId, useState } from 'react';

// A white panel with a title row. Collapsible cards put their title in a disclosure button.
export default function Card({ title, badge, actions, collapsible = false, defaultOpen = true, className = '', children }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const expanded = !collapsible || open;
  return (
    <section className={`panel${expanded ? '' : ' collapsed'} ${className}`}>
      <div className="card-head">
        <div className="card-title-group">
          {collapsible ? (
            <button type="button" className="card-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(o => !o)}>
              {title}
            </button>
          ) : <h3>{title}</h3>}
          {badge}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
      {expanded && <div className="card-body" id={bodyId}>{children}</div>}
    </section>
  );
}
