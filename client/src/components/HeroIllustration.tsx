import { motion } from 'framer-motion';
import { FileText, Brain, Shield, Sparkles, MessageSquare } from 'lucide-react';

export function HeroIllustration() {
  return (
    <div className="relative w-full h-[400px] sm:h-[500px] flex items-center justify-center">
      {/* Main AI Assistant Device */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative"
      >
        {/* Base Platform */}
        <div className="relative">
          {/* Platform shadow */}
          <div 
            className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-48 h-8 rounded-full bg-gradient-to-r from-violet-500/20 via-purple-500/30 to-violet-500/20 blur-xl"
          />
          
          {/* Platform base */}
          <div 
            className="w-40 h-6 mx-auto rounded-lg"
            style={{
              background: 'linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 100%)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.8)',
            }}
          />
          
          {/* Main device body */}
          <div 
            className="w-32 h-24 mx-auto -mt-2 rounded-2xl relative overflow-hidden"
            style={{
              background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 50%, #cbd5e1 100%)',
              boxShadow: `
                0 20px 40px rgba(0,0,0,0.15),
                0 0 0 1px rgba(255,255,255,0.5) inset,
                0 -2px 0 rgba(0,0,0,0.05) inset
              `,
            }}
          >
            {/* Silver band */}
            <div 
              className="absolute bottom-4 left-0 right-0 h-3"
              style={{
                background: 'linear-gradient(180deg, #94a3b8 0%, #64748b 50%, #94a3b8 100%)',
              }}
            />
            
            {/* Glossy highlight */}
            <div 
              className="absolute top-0 left-0 right-0 h-1/3"
              style={{
                background: 'linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 100%)',
              }}
            />
          </div>
          
          {/* Holographic display */}
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -top-32 left-1/2 -translate-x-1/2 w-48 h-36"
          >
            {/* Glass panel */}
            <div 
              className="w-full h-full rounded-xl relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(236, 72, 153, 0.05) 50%, rgba(99, 102, 241, 0.1) 100%)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.3)',
                boxShadow: '0 8px 32px rgba(139, 92, 246, 0.2), inset 0 0 20px rgba(255,255,255,0.1)',
              }}
            >
              {/* AI Brain icon */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <motion.div
                  animate={{ rotate: [0, 5, -5, 0] }}
                  transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Brain className="w-16 h-16 text-violet-500/80" strokeWidth={1.5} />
                </motion.div>
              </div>
              
              {/* Gradient text "AI" */}
              <div 
                className="absolute top-3 left-1/2 -translate-x-1/2 text-2xl font-bold"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                AI
              </div>
              
              {/* Scan lines effect */}
              <div 
                className="absolute inset-0 opacity-30"
                style={{
                  background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(139, 92, 246, 0.03) 2px, rgba(139, 92, 246, 0.03) 4px)',
                }}
              />
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Floating Document Icons */}
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="absolute left-[5%] sm:left-[10%] top-1/3"
      >
        <motion.div
          animate={{ y: [0, -8, 0], rotate: [-5, -8, -5] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          className="w-12 h-14 sm:w-14 sm:h-16 rounded-lg flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
            boxShadow: '0 8px 24px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          <FileText className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          {/* Document lines */}
          <div className="absolute bottom-2 left-2 right-2 space-y-1">
            <div className="h-0.5 bg-white/40 rounded" />
            <div className="h-0.5 bg-white/30 rounded w-3/4" />
          </div>
        </motion.div>
      </motion.div>

      {/* Floating Shield Icon */}
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="absolute right-[5%] sm:right-[10%] top-1/4"
      >
        <motion.div
          animate={{ y: [0, -10, 0], rotate: [5, 8, 5] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="w-10 h-12 sm:w-12 sm:h-14 rounded-lg flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
            boxShadow: '0 8px 24px rgba(236, 72, 153, 0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
        </motion.div>
      </motion.div>

      {/* Floating Message Icon */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="absolute right-[15%] sm:right-[20%] bottom-1/4"
      >
        <motion.div
          animate={{ y: [0, -6, 0], rotate: [3, 6, 3] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
            boxShadow: '0 8px 24px rgba(99, 102, 241, 0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
        </motion.div>
      </motion.div>

      {/* Glass Orbs */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="absolute right-[2%] sm:right-[5%] top-[10%]"
      >
        <motion.div
          animate={{ y: [0, -15, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-full relative"
          style={{
            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(236, 72, 153, 0.15) 50%, rgba(99, 102, 241, 0.2) 100%)',
            boxShadow: 'inset 0 0 20px rgba(255,255,255,0.2), 0 0 40px rgba(139, 92, 246, 0.2)',
            backdropFilter: 'blur(5px)',
          }}
        >
          {/* Highlight */}
          <div 
            className="absolute top-2 left-3 w-6 h-4 rounded-full"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, transparent 100%)',
            }}
          />
          {/* Rainbow refraction */}
          <div 
            className="absolute bottom-3 right-3 w-4 h-2 rounded-full opacity-60"
            style={{
              background: 'linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb)',
              filter: 'blur(2px)',
            }}
          />
        </motion.div>
      </motion.div>

      {/* Small floating orbs */}
      <motion.div
        animate={{ y: [0, -8, 0], x: [0, 3, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        className="absolute left-[20%] bottom-[30%] w-4 h-4 rounded-full"
        style={{
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.6), rgba(236, 72, 153, 0.4))',
          boxShadow: '0 0 20px rgba(139, 92, 246, 0.4)',
        }}
      />
      
      <motion.div
        animate={{ y: [0, -6, 0], x: [0, -2, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute right-[25%] top-[20%] w-3 h-3 rounded-full"
        style={{
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.6), rgba(139, 92, 246, 0.4))',
          boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)',
        }}
      />

      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 3 }}
        className="absolute left-[30%] top-[15%] w-2 h-2 rounded-full"
        style={{
          background: 'rgba(236, 72, 153, 0.5)',
          boxShadow: '0 0 10px rgba(236, 72, 153, 0.4)',
        }}
      />

      {/* Sparkle effects */}
      <motion.div
        animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute left-[15%] top-[25%]"
      >
        <Sparkles className="w-4 h-4 text-violet-400" />
      </motion.div>
      
      <motion.div
        animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        className="absolute right-[18%] bottom-[35%]"
      >
        <Sparkles className="w-3 h-3 text-pink-400" />
      </motion.div>
    </div>
  );
}
