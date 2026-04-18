import { NavLink } from 'react-router-dom';

const MOBILE_TABS = [
  { to: '/dashboard',        label: 'Dashboard', icon: '🏠' },
  { to: '/queue/completion', label: 'Queue',     icon: '📋' },
  { to: '/products',         label: 'Products',  icon: '📦' },
  { to: '/more',             label: 'More',      icon: '☰'  },
];

export function MobileBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t flex md:hidden">
      {MOBILE_TABS.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-xs font-medium transition-colors
             ${isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`
          }
        >
          <span className="text-lg leading-none">{tab.icon}</span>
          <span className="mt-0.5">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
