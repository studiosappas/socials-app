"use client";

import { motion } from "framer-motion";
import { REVEAL_TRANSITION } from "@/lib/landing";

export function ScrollReveal({
  children,
  delay = 0,
  y = 16,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ ...REVEAL_TRANSITION, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
