import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AnimatedOrbProps {
  className?: string;
  hue?: number;
  isActive?: boolean;
  intensity?: number;
}

export function AnimatedOrb({ 
  className, 
  hue = 270, 
  isActive = false,
  intensity = 0.5 
}: AnimatedOrbProps) {
  // Convert hue to HSL colors for the gradient
  const primaryColor = `hsl(${hue}, 80%, 60%)`;
  const secondaryColor = `hsl(${(hue + 30) % 360}, 70%, 50%)`;
  const tertiaryColor = `hsl(${(hue - 30 + 360) % 360}, 90%, 70%)`;
  const glowColor = `hsla(${hue}, 80%, 60%, 0.4)`;

  return (
    <div className={cn('relative w-full h-full', className)}>
      {/* Outer glow — always breathes; faster and brighter when active. */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
        }}
        animate={{
          scale: isActive ? [1, 1.2, 1] : [1, 1.08, 1],
          opacity: isActive ? [0.5, 0.8, 0.5] : [0.25, 0.45, 0.25],
        }}
        transition={{
          duration: isActive ? 2 : 4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Main orb container */}
      <div className="absolute inset-[10%] rounded-full overflow-hidden">
        {/* Animated gradient background */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: `
              radial-gradient(circle at 30% 30%, ${tertiaryColor} 0%, transparent 50%),
              radial-gradient(circle at 70% 70%, ${secondaryColor} 0%, transparent 50%),
              linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 50%, ${tertiaryColor} 100%)
            `,
          }}
          animate={{
            rotate: isActive ? 360 : 0,
          }}
          transition={{
            duration: isActive ? 8 : 20,
            repeat: Infinity,
            ease: 'linear',
          }}
        />

        {/* Inner glow layer — same breath principle as outer glow. */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 40% 40%, rgba(255,255,255,0.4) 0%, transparent 50%)`,
          }}
          animate={{
            opacity: isActive ? [0.3, 0.6, 0.3] : [0.22, 0.38, 0.22],
          }}
          transition={{
            duration: isActive ? 1.5 : 4,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Swirling effect layer 1 */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 0deg, transparent, ${primaryColor}40, transparent, ${secondaryColor}40, transparent)`,
          }}
          animate={{
            rotate: isActive ? -360 : 0,
          }}
          transition={{
            duration: isActive ? 4 : 12,
            repeat: Infinity,
            ease: 'linear',
          }}
        />

        {/* Swirling effect layer 2 */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 180deg, transparent, ${tertiaryColor}30, transparent, ${primaryColor}30, transparent)`,
          }}
          animate={{
            rotate: isActive ? 360 : 0,
          }}
          transition={{
            duration: isActive ? 6 : 15,
            repeat: Infinity,
            ease: 'linear',
          }}
        />

        {/* Center highlight */}
        <div
          className="absolute inset-[20%] rounded-full"
          style={{
            background: `radial-gradient(circle, rgba(255,255,255,0.2) 0%, transparent 70%)`,
          }}
        />

        {/* Glass reflection */}
        <div
          className="absolute top-[5%] left-[15%] w-[30%] h-[20%] rounded-full"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.4) 0%, transparent 100%)',
            filter: 'blur(4px)',
          }}
        />
      </div>

      {/* Pulse rings when active */}
      {isActive && (
        <>
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ border: `2px solid ${primaryColor}40` }}
            initial={{ scale: 0.8, opacity: 0.6 }}
            animate={{ scale: 1.3, opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ border: `1px solid ${secondaryColor}30` }}
            initial={{ scale: 0.8, opacity: 0.4 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
          />
        </>
      )}
    </div>
  );
}
