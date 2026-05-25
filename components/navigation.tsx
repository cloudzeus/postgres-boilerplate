import Link from 'next/link';

const navItems = [
    { label: 'Home', href: '/' },
    { label: 'Docs', href: '/docs' },
    { label: 'Excel Import', href: '/excel-import' },
    { label: 'Profile', href: '/profile' },
];

export default function Navigation() {
    return (
        <nav className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.28em] text-slate-400">
            {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-full px-3 py-2 hover:bg-slate-800/80 hover:text-white transition duration-180">
                    {item.label}
                </Link>
            ))}
        </nav>
    );
}
