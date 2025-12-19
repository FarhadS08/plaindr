import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Icon3DProps {
  icon: LucideIcon;
  variant?: 'purple' | 'blue' | 'pink' | 'green' | 'orange';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const variantStyles = {
  purple: {
    gradient: 'from-violet-500 via-purple-500 to-fuchsia-500',
    shadow: 'shadow-violet-500/30',
    glow: 'group-hover:shadow-violet-500/50',
    iconColor: 'text-white',
  },
  blue: {
    gradient: 'from-blue-500 via-indigo-500 to-violet-500',
    shadow: 'shadow-blue-500/30',
    glow: 'group-hover:shadow-blue-500/50',
    iconColor: 'text-white',
  },
  pink: {
    gradient: 'from-pink-500 via-rose-500 to-red-400',
    shadow: 'shadow-pink-500/30',
    glow: 'group-hover:shadow-pink-500/50',
    iconColor: 'text-white',
  },
  green: {
    gradient: 'from-emerald-500 via-green-500 to-teal-500',
    shadow: 'shadow-emerald-500/30',
    glow: 'group-hover:shadow-emerald-500/50',
    iconColor: 'text-white',
  },
  orange: {
    gradient: 'from-orange-500 via-amber-500 to-yellow-500',
    shadow: 'shadow-orange-500/30',
    glow: 'group-hover:shadow-orange-500/50',
    iconColor: 'text-white',
  },
};

const sizeStyles = {
  sm: {
    container: 'w-10 h-10',
    icon: 'w-5 h-5',
    shadow: 'shadow-lg',
  },
  md: {
    container: 'w-14 h-14',
    icon: 'w-7 h-7',
    shadow: 'shadow-xl',
  },
  lg: {
    container: 'w-16 h-16',
    icon: 'w-8 h-8',
    shadow: 'shadow-xl',
  },
  xl: {
    container: 'w-20 h-20',
    icon: 'w-10 h-10',
    shadow: 'shadow-2xl',
  },
};

export function Icon3D({ icon: Icon, variant = 'purple', size = 'lg', className }: Icon3DProps) {
  const variantStyle = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  return (
    <div className={cn('group relative', className)}>
      {/* 3D Shadow/Depth layer */}
      <div
        className={cn(
          'absolute inset-0 rounded-2xl bg-gradient-to-br opacity-40 blur-xl transition-all duration-300',
          variantStyle.gradient,
          'group-hover:opacity-60 group-hover:blur-2xl'
        )}
        style={{ transform: 'translateY(4px) scale(0.9)' }}
      />
      
      {/* Main icon container with 3D effect */}
      <div
        className={cn(
          'relative rounded-2xl bg-gradient-to-br flex items-center justify-center transition-all duration-300',
          variantStyle.gradient,
          sizeStyle.container,
          sizeStyle.shadow,
          variantStyle.shadow,
          'group-hover:scale-105 group-hover:-translate-y-1',
          variantStyle.glow
        )}
        style={{
          boxShadow: `
            0 4px 6px -1px rgba(0, 0, 0, 0.1),
            0 2px 4px -2px rgba(0, 0, 0, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.2),
            inset 0 -2px 0 rgba(0, 0, 0, 0.1)
          `,
        }}
      >
        {/* Glossy highlight */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, transparent 50%, transparent 100%)',
          }}
        />
        
        {/* Icon */}
        <Icon className={cn(sizeStyle.icon, variantStyle.iconColor, 'relative z-10 drop-shadow-sm')} />
      </div>
    </div>
  );
}

// Floating orb component for decorative elements
interface FloatingOrbProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'purple' | 'blue' | 'pink' | 'rainbow';
  className?: string;
  animate?: boolean;
}

const orbVariants = {
  purple: 'from-violet-400 via-purple-500 to-fuchsia-500',
  blue: 'from-blue-400 via-cyan-500 to-teal-400',
  pink: 'from-pink-400 via-rose-500 to-red-400',
  rainbow: 'from-violet-400 via-pink-500 to-orange-400',
};

const orbSizes = {
  sm: 'w-8 h-8',
  md: 'w-16 h-16',
  lg: 'w-24 h-24',
};

export function FloatingOrb({ size = 'md', variant = 'purple', className, animate = true }: FloatingOrbProps) {
  return (
    <div
      className={cn(
        'rounded-full bg-gradient-to-br opacity-60 blur-sm',
        orbVariants[variant],
        orbSizes[size],
        animate && 'animate-float',
        className
      )}
      style={{
        boxShadow: '0 0 40px rgba(139, 92, 246, 0.3)',
      }}
    />
  );
}

// Glass orb with reflection for hero section
interface GlassOrbProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const glassOrbSizes = {
  sm: 'w-12 h-12',
  md: 'w-20 h-20',
  lg: 'w-32 h-32',
  xl: 'w-48 h-48',
};

export function GlassOrb({ size = 'md', className }: GlassOrbProps) {
  return (
    <div className={cn('relative', glassOrbSizes[size], className)}>
      {/* Main orb */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(236, 72, 153, 0.2) 50%, rgba(59, 130, 246, 0.3) 100%)',
          boxShadow: `
            inset 0 0 30px rgba(255, 255, 255, 0.1),
            0 0 60px rgba(139, 92, 246, 0.2)
          `,
          backdropFilter: 'blur(10px)',
        }}
      />
      
      {/* Highlight reflection */}
      <div
        className="absolute top-[10%] left-[15%] w-[40%] h-[30%] rounded-full"
        style={{
          background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, transparent 100%)',
        }}
      />
      
      {/* Rainbow refraction */}
      <div
        className="absolute bottom-[20%] right-[20%] w-[30%] h-[20%] rounded-full opacity-50"
        style={{
          background: 'linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3)',
          filter: 'blur(4px)',
        }}
      />
    </div>
  );
}
