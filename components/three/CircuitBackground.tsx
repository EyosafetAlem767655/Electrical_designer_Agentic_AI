"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

function ParticleGrid() {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const values: number[] = [];
    for (let x = -18; x <= 18; x += 2) {
      for (let z = -12; z <= 12; z += 2) {
        values.push(x, Math.sin(x * z) * 0.06 - 3, z);
      }
    }
    return new Float32Array(values);
  }, []);

  useFrame(({ clock }) => {
    if (points.current) {
      points.current.rotation.y = clock.elapsedTime * 0.015;
      points.current.position.y = Math.sin(clock.elapsedTime * 0.4) * 0.15;
    }
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#00f0ff" size={0.045} transparent opacity={0.42} />
    </points>
  );
}

export function CircuitBackground() {
  return (
    <div className="fixed inset-0 -z-20 opacity-75">
      <Canvas camera={{ position: [0, 6, 16], fov: 48 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.6} />
        <ParticleGrid />
      </Canvas>
    </div>
  );
}
