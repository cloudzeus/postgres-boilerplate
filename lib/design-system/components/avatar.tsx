'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface User {
  name: string;
  avatarUrl?: string;
}

interface AvatarProps {
  user: User;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showPresence?: boolean;
  className?: string;
}

const sizeMap = {
  xs: { size: 'h-6 w-6', text: 'text-[10px]' },
  sm: { size: 'h-8 w-8', text: 'text-xs' },
  md: { size: 'h-10 w-10', text: 'text-sm' },
  lg: { size: 'h-12 w-12', text: 'text-base' },
};

const presenceSizeMap = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
};

const avatarColors = [
  'bg-sisyphus-500',
  'bg-accent-purple',
  'bg-accent-green',
  'bg-accent-orange',
  'bg-accent-teal',
  'bg-accent-pink',
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getColorIndex(name: string): number {
  return name.charCodeAt(0) % avatarColors.length;
}

/**
 * DG Avatar — User profile picture or initials
 */
export function Avatar({ 
  user, 
  size = 'sm', 
  showPresence, 
  className 
}: AvatarProps) {
  const initials = getInitials(user.name);
  const colorIdx = getColorIndex(user.name);
  const sizeConfig = sizeMap[size];

  return (
    <div className={cn('relative inline-flex', className)}>
      <div className={cn(
        'rounded-sm flex items-center justify-center font-semibold text-white overflow-hidden ring-2 ring-white',
        sizeConfig.size,
        sizeConfig.text,
        !user.avatarUrl && avatarColors[colorIdx],
      )}>
        {user.avatarUrl ? (
          <Image 
            src={user.avatarUrl} 
            alt={user.name} 
            width={48} 
            height={48} 
            className="object-cover w-full h-full"
          />
        ) : (
          initials
        )}
      </div>
      
      {showPresence && (
        <span className={cn(
          'absolute bottom-0 right-0 rounded-full ring-2 ring-white bg-success-500',
          presenceSizeMap[size],
        )} />
      )}
    </div>
  );
}

interface AvatarStackProps {
  users: User[];
  max?: number;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

/**
 * DG AvatarStack — Multiple avatars with overflow indicator
 */
export function AvatarStack({ 
  users, 
  max = 3, 
  size = 'sm',
  className,
}: AvatarStackProps) {
  const shown = users.slice(0, max);
  const extra = users.length - max;
  const sizeConfig = sizeMap[size];

  return (
    <div className={cn('flex -space-x-2', className)}>
      {shown.map((user, i) => (
        <Avatar 
          key={`${user.name}-${i}`}
          user={user} 
          size={size}
        />
      ))}
      
      {extra > 0 && (
        <div className={cn(
          'rounded-sm ring-2 ring-white bg-neutral-10 text-neutral-70 flex items-center justify-center font-semibold',
          sizeConfig.size,
          sizeConfig.text,
        )}>
          +{extra}
        </div>
      )}
    </div>
  );
}
