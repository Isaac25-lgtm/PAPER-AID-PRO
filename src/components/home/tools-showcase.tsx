"use client";

import * as React from "react";
import Link from "next/link";
import {
  Brain,
  FileText,
  SearchCheck,
  Compass,
  BookOpenCheck,
  GraduationCap,
  PenTool,
  CheckCircle2,
  Sparkles,
  Quote,
  FolderSync,
  BarChart3,
  ClipboardList,
  Cpu,
  ArrowRight,
  Layers,
  Search,
} from "lucide-react";
import { siteConfig, AcademicTool } from "@/config/site";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ElementType> = {
  Brain,
  FileText,
  SearchCheck,
  Compass,
  BookOpenCheck,
  GraduationCap,
  PenTool,
  CheckCircle2,
  Sparkles,
  Quote,
  FolderSync,
  BarChart3,
  ClipboardList,
  Cpu,
};

export function ToolsShowcase() {
  const [activeCategory, setActiveCategory] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState<string>("");

  const categories = [
    { id: "all", label: "All Tools (14+)" },
    { id: "research", label: "Research & Review" },
    { id: "writing", label: "Writing & Publishing" },
    { id: "citations", label: "Citations & References" },
    { id: "analytics", label: "Data & MCP" },
  ];

  const filteredTools = siteConfig.academicTools.filter((tool: AcademicTool) => {
    const matchesCat = activeCategory === "all" || tool.category === activeCategory;
    const matchesSearch =
      searchQuery === "" ||
      tool.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <section id="tools" className="py-16 sm:py-24 relative bg-slate-50/60 border-y border-slate-200/80">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
        {/* Section Header */}
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/80 px-3.5 py-1 text-xs font-semibold text-indigo-700 shadow-xs">
            <Layers className="h-3.5 w-3.5" />
            <span>Complete Academic AI Suite</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Every Research Capability. One Intelligent Hub.
          </h2>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            From preliminary literature discovery to thesis conversion, peer-review simulation,
            and publication-ready citation exports.
          </p>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between max-w-4xl mx-auto">
          {/* Categories */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                  activeCategory === cat.id
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Quick Search Filter */}
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-full border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Tools Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredTools.map((tool: AcademicTool) => {
            const Icon = iconMap[tool.iconName] || Brain;

            return (
              <Card
                key={tool.id}
                className="group relative flex flex-col justify-between border-slate-200/90 bg-white hover:border-indigo-300 hover:shadow-md transition-all duration-200"
              >
                <CardHeader className="p-5 pb-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-200">
                      <Icon className="h-5 w-5" />
                    </div>
                    {tool.badge && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 border-indigo-200"
                      >
                        {tool.badge}
                      </Badge>
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {tool.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      {tool.description}
                    </p>
                  </div>
                </CardHeader>

                <CardContent className="p-5 pt-0">
                  <Link
                    href={tool.href}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors mt-2"
                  >
                    <span>Launch Tool</span>
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Bottom Banner */}
        <div className="text-center pt-4">
          <Link
            href="/tools"
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-indigo-600 transition-colors"
          >
            <span>Explore all features, tutorials, and academic documentation</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
