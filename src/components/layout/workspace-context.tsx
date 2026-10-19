"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { DocumentType } from "@prisma/client";

interface WorkspaceContextValue {
  isSidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (val: boolean) => void;
  isMobileNavOpen: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  isNewDocumentModalOpen: boolean;
  openNewDocumentModal: (preselectedType?: DocumentType) => void;
  closeNewDocumentModal: () => void;
  modalInitialDocType?: DocumentType;
  isHelpGuidesOpen: boolean;
  openHelpGuides: () => void;
  closeHelpGuides: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

const STORAGE_KEY = "ai_research_hub_sidebar_collapsed";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Sidebar collapse state with localStorage persistence
  const [isSidebarCollapsed, setIsSidebarCollapsedState] = useState(false);
  const [hasInitializedFromStorage, setHasInitializedFromStorage] = useState(false);

  // Mobile drawer state
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // New Document Modal state
  const [isNewDocumentModalOpen, setIsNewDocumentModalOpen] = useState(false);
  const [modalInitialDocType, setModalInitialDocType] = useState<DocumentType | undefined>(undefined);

  // Help & Guides Modal state
  const [isHelpGuidesOpen, setIsHelpGuidesOpen] = useState(false);

  // Load collapse preference from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        setIsSidebarCollapsedState(stored === "true");
      }
    } catch {}
    setHasInitializedFromStorage(true);
  }, []);

  // In Research Editor canvas (/editor/[id]), auto-compact sidebar to preserve writing space if not user-toggled
  useEffect(() => {
    const isEditorCanvas = pathname.startsWith("/editor/") && pathname !== "/editor";
    if (isEditorCanvas && !hasInitializedFromStorage) {
      setIsSidebarCollapsedState(true);
    }
  }, [pathname, hasInitializedFromStorage]);

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [pathname]);

  const toggleSidebarCollapsed = useCallback(() => {
    setIsSidebarCollapsedState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const setSidebarCollapsed = useCallback((val: boolean) => {
    setIsSidebarCollapsedState(val);
    try {
      localStorage.setItem(STORAGE_KEY, String(val));
    } catch {}
  }, []);

  const openMobileNav = useCallback(() => setIsMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setIsMobileNavOpen(false), []);

  const openNewDocumentModal = useCallback((preselectedType?: DocumentType) => {
    setModalInitialDocType(preselectedType);
    setIsNewDocumentModalOpen(true);
  }, []);

  const closeNewDocumentModal = useCallback(() => {
    setIsNewDocumentModalOpen(false);
    setModalInitialDocType(undefined);
  }, []);

  const openHelpGuides = useCallback(() => setIsHelpGuidesOpen(true), []);
  const closeHelpGuides = useCallback(() => setIsHelpGuidesOpen(false), []);

  return (
    <WorkspaceContext.Provider
      value={{
        isSidebarCollapsed,
        toggleSidebarCollapsed,
        setSidebarCollapsed,
        isMobileNavOpen,
        openMobileNav,
        closeMobileNav,
        isNewDocumentModalOpen,
        openNewDocumentModal,
        closeNewDocumentModal,
        modalInitialDocType,
        isHelpGuidesOpen,
        openHelpGuides,
        closeHelpGuides,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}

export function useOptionalWorkspace(): WorkspaceContextValue | null {
  const context = useContext(WorkspaceContext);
  return context ?? null;
}
