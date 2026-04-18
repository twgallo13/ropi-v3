import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const LINKS = [
  { to: '/import-hub',          label: 'Import Hub',           icon: '📥' },
  { to: '/export-center',       label: 'Export Center',        icon: '📤' },
  { to: '/advisory',            label: 'Advisory',             icon: '📋' },
  { to: '/executive',           label: 'Executive Dashboard',  icon: '📊', roles: ['admin', 'owner', 'head_buyer'] },
  { to: '/buyer-performance',   label: 'Buyer Performance',    icon: '👤', roles: ['admin', 'owner', 'head_buyer', 'buyer'] },
  { to: '/admin/settings',      label: 'Admin Settings',       icon: '🔧', roles: ['admin', 'owner'] },
  { to: '/settings/notifications', label: 'Notifications',     icon: '🔔' },
];

export default function MorePage() {
  const { role } = useAuth();
  const canSee = (roles?: string[]) => !roles || (role ? roles.includes(role) : false);

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">More</h1>
      <div className="space-y-1">
        {LINKS.filter(l => canSee(l.roles)).map(link => (
          <Link
            key={link.to}
            to={link.to}
            className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 text-gray-800"
          >
            <span className="text-lg">{link.icon}</span>
            <span className="text-sm font-medium">{link.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
