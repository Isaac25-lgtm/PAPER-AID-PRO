"use client";

import React from "react";
import { NormalizedExternalPaper } from "@/lib/discovery/types";
import { CitePaperModal } from "@/components/citations/cite-paper-modal";

interface CiteModalProps {
  isOpen: boolean;
  onClose: () => void;
  paper: NormalizedExternalPaper | null;
}

export function CiteModal({ isOpen, onClose, paper }: CiteModalProps) {
  if (!isOpen || !paper) return null;

  return (
    <CitePaperModal
      isOpen={isOpen}
      onClose={onClose}
      paper={{
        id: paper.id,
        title: paper.title,
        authors: paper.authors.map((a) => a.name),
        year: paper.year,
        journal: paper.journal,
        doi: paper.doi,
        abstract: paper.abstract,
      }}
    />
  );
}
