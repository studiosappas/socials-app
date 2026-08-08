"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SORTABLE_TRANSITION } from "@/lib/dnd-motion";
import { LandingMedia } from "../landing-media";
import { DEMO_GRID_SLOTS } from "@/lib/landing";

// Real @dnd-kit drag-and-drop, same sensor/transition config as the real
// Grid page (grid-board.tsx) -- reorders local state only, no persistence,
// no server action. Same feel as production, zero backend coupling.
export function DemoGridDrag() {
  const [slots, setSlots] = useState(DEMO_GRID_SLOTS.slice(0, 4));
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setSlots((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  const activeSlot = slots.find((s) => s.id === activeId);

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-xs tracking-wide text-muted uppercase">Drag a post to reorder the feed</p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={slots.map((s) => s.id)} strategy={rectSortingStrategy}>
          <div className="grid w-full max-w-xs grid-cols-2 gap-[2px] sm:max-w-sm">
            {slots.map((slot) => (
              <SortableSlot key={slot.id} id={slot.id} image={slot.image} />
            ))}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={SORTABLE_TRANSITION}>
          {activeSlot && <LandingMedia media={activeSlot.image} className="aspect-[4/5]" />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function SortableSlot({ id, image }: { id: string; image: (typeof DEMO_GRID_SLOTS)[number]["image"] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: SORTABLE_TRANSITION,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`aspect-[4/5] cursor-grab touch-none border border-border transition-[opacity,border-color] duration-150 hover:border-foreground/30 ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <LandingMedia media={image} className="aspect-[4/5]" />
    </div>
  );
}
