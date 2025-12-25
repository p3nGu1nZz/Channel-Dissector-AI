import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { TopicGraphData, GraphNode, GraphLink } from '../types';
import { COLORS } from '../constants';
import { ZoomIn, ZoomOut, Maximize, MousePointer2 } from 'lucide-react';

interface ForceGraphProps {
  data: TopicGraphData;
  onNodeClick?: (node: GraphNode) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
}

const ForceGraph: React.FC<ForceGraphProps> = ({ data, onNodeClick, onNodeDoubleClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomGroupRef = useRef<SVGGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [zoomTransform, setZoomTransform] = useState<d3.ZoomTransform | null>(null);

  // Initialize Zoom
  useEffect(() => {
    if (!svgRef.current || !zoomGroupRef.current) return;

    const svg = d3.select(svgRef.current);
    const g = d3.select(zoomGroupRef.current);

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        setZoomTransform(event.transform);
      });

    svg.call(zoom);
  }, []);

  // Zoom Helpers
  const handleZoomIn = () => {
    if (svgRef.current) d3.select(svgRef.current).transition().duration(300).call(d3.zoom().scaleBy as any, 1.3);
  };

  const handleZoomOut = () => {
    if (svgRef.current) d3.select(svgRef.current).transition().duration(300).call(d3.zoom().scaleBy as any, 1 / 1.3);
  };

  const handleResetZoom = () => {
    if (svgRef.current && containerRef.current) {
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      d3.select(svgRef.current).transition().duration(750).call(d3.zoom().transform as any, d3.zoomIdentity.translate(width/2, height/2).scale(0.8));
    }
  };

  // Main Simulation Effect
  useEffect(() => {
    if (!data.nodes.length || !zoomGroupRef.current) return;

    const g = d3.select(zoomGroupRef.current);
    g.selectAll("*").remove(); // Clear previous render within zoom group

    // --- DATA SANITIZATION ---
    // 1. Convert all IDs to strings to prevent Type mismatches (Number vs String) from import parsers
    const validNodeIds = new Set(data.nodes.map(n => String(n.id)));

    const nodes = data.nodes.map(d => ({ 
      ...d,
      id: String(d.id) 
    })) as d3.SimulationNodeDatum[];
    
    // 2. Map links to use String IDs and FILTER out orphans (links to missing nodes)
    // This is critical for preventing "exploded" graphs where edges connect to (0,0)
    const links = data.links
      .map((d: any) => ({
        ...d,
        source: typeof d.source === 'object' ? String(d.source.id) : String(d.source),
        target: typeof d.target === 'object' ? String(d.target.id) : String(d.target)
      }))
      .filter(d => validNodeIds.has(d.source) && validNodeIds.has(d.target));

    // Reset zoom to center on data load
    handleResetZoom();

    // Color scale based on groups
    const colorScale = d3.scaleOrdinal<number, string>()
      .domain([1, 2, 3])
      .range([COLORS.nodeGroup1, COLORS.nodeGroup2, COLORS.nodeGroup3]);

    // Hierarchy Simulation
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links)
        .id((d: any) => d.id)
        .distance((d) => 150 - (d.value * 10)) // Stronger links are shorter
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force("collide", d3.forceCollide().radius((d: any) => {
         // Collision radius based on relevance/popularity
         const r = ((d.relevance || 5) + (d.popularity || 5));
         return r * 1.5 + 10;
      }))
      .force("r", d3.forceRadial(
        (d: any) => d.group === 1 ? 0 : d.group === 2 ? 200 : 400, // Concentric rings
        0, 0 // Centered at 0,0 (Zoom handles the translation)
      ).strength(0.5));

    // Draw lines for links
    const link = g.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#52525b") // zinc-600
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", (d) => Math.sqrt(d.value || 1) * 1.5);

    // Draw circles for nodes
    const node = g.append("g")
      .attr("class", "nodes")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      // Size based on Relevance + Popularity
      .attr("r", (d: any) => {
         const base = d.group === 1 ? 15 : d.group === 2 ? 10 : 6;
         const weight = ((d.relevance || 5) + (d.popularity || 5)) / 4;
         return base + weight;
      })
      .attr("fill", (d: any) => colorScale(d.group))
      .attr("stroke", "#18181b")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .call(drag(simulation) as any)
      .on("mouseover", (event, d: any) => {
        setHoveredNode(d as GraphNode);
      })
      .on("mouseout", (event) => {
        setHoveredNode(null);
      })
      .on("click", (event, d: any) => {
        if (onNodeClick) onNodeClick(d as GraphNode);
      })
      .on("dblclick", (event, d: any) => {
        event.stopPropagation(); // Prevent zooming on double click
        if (onNodeDoubleClick) onNodeDoubleClick(d as GraphNode);
      });

    // Draw labels
    const labels = g.append("g")
      .attr("class", "labels")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .attr("dx", (d: any) => {
        const r = ((d.relevance || 5) + (d.popularity || 5)) / 4 + (d.group === 1 ? 15 : 10);
        return r + 5;
      })
      .attr("dy", 4)
      .text((d: any) => d.id)
      .attr("fill", "#e4e4e7") // zinc-200
      .style("font-size", (d: any) => d.group === 1 ? "14px" : "10px")
      .style("font-weight", (d: any) => d.group === 1 ? "700" : "400")
      .style("font-family", "Inter, sans-serif")
      .style("pointer-events", "none")
      .style("text-shadow", "2px 2px 4px #000");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node
        .attr("cx", (d: any) => d.x)
        .attr("cy", (d: any) => d.y);

      labels
        .attr("x", (d: any) => d.x)
        .attr("y", (d: any) => d.y);
    });

    // Clean up
    return () => {
      simulation.stop();
    };
  }, [data, onNodeClick, onNodeDoubleClick]);

  // Interaction Effect: Highlight Neighbors
  useEffect(() => {
    if (!zoomGroupRef.current) return;
    const g = d3.select(zoomGroupRef.current);
    const nodes = g.selectAll(".nodes circle");
    const links = g.selectAll(".links line");
    const labels = g.selectAll(".labels text");

    if (hoveredNode) {
        // Calculate neighbors
        const neighborIds = new Set<string>();
        neighborIds.add(String(hoveredNode.id)); // Ensure ID comparison is string-safe

        const connectedLinks = new Set<any>();

        // We check the D3 data bound to the link elements
        // Note: D3 replaces source/target string IDs with object references during simulation
        // The data in 'links' selection is the mutated data from simulation
        links.each((d: any) => {
             // Safe extraction of IDs whether they are objects or strings
             const sId = typeof d.source === 'object' ? String(d.source.id) : String(d.source);
             const tId = typeof d.target === 'object' ? String(d.target.id) : String(d.target);
            
             if (sId === String(hoveredNode.id)) {
                neighborIds.add(tId);
                connectedLinks.add(d);
             } else if (tId === String(hoveredNode.id)) {
                neighborIds.add(sId);
                connectedLinks.add(d);
             }
        });

        // Dim everything unrelated
        nodes.transition().duration(200)
            .style("opacity", (d: any) => neighborIds.has(String(d.id)) ? 1 : 0.1)
            .attr("stroke", (d: any) => String(d.id) === String(hoveredNode.id) ? COLORS.accent : "#18181b")
            .attr("stroke-width", (d: any) => String(d.id) === String(hoveredNode.id) ? 4 : 2)
            .attr("filter", (d: any) => String(d.id) === String(hoveredNode.id) ? "drop-shadow(0px 0px 8px rgba(244, 63, 94, 0.5))" : null);

        links.transition().duration(200)
            .style("opacity", (d: any) => connectedLinks.has(d) ? 1 : 0.05)
            .attr("stroke", (d: any) => connectedLinks.has(d) ? "#e4e4e7" : "#52525b");

        labels.transition().duration(200)
            .style("opacity", (d: any) => neighborIds.has(String(d.id)) ? 1 : 0.1);

    } else {
        // Reset to default
        nodes.transition().duration(200)
            .style("opacity", 1)
            .attr("stroke", "#18181b")
            .attr("stroke-width", 2)
            .attr("filter", null);

        links.transition().duration(200)
            .style("opacity", 1)
            .attr("stroke", "#52525b")
            .attr("stroke-opacity", 0.4);

        labels.transition().duration(200)
            .style("opacity", 1);
    }

  }, [hoveredNode]); 


  // Drag behavior
  const drag = (simulation: d3.Simulation<d3.SimulationNodeDatum, undefined>) => {
    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    return d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended);
  };

  return (
    <div className="relative w-full h-full bg-[#050505] rounded-xl border border-zinc-800 overflow-hidden shadow-inner" ref={containerRef}>
      {/* Grid Background */}
      <div className="absolute inset-0 opacity-10 pointer-events-none" 
           style={{
             backgroundImage: 'radial-gradient(#3f3f46 1px, transparent 1px)', 
             backgroundSize: '20px 20px'
           }}>
      </div>

      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing">
        <g ref={zoomGroupRef} />
      </svg>
      
      {/* Hover Tooltip (Basic) */}
      {hoveredNode && (
        <div className="absolute top-4 left-4 bg-black/90 backdrop-blur border border-zinc-700 p-3 rounded-lg max-w-xs pointer-events-none animate-fade-in z-20 shadow-xl">
          <h4 className="font-bold text-blue-400 mb-1 flex justify-between items-center">
            {hoveredNode.id}
            <span className="text-[9px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400 border border-zinc-700">DOUBLE CLICK</span>
          </h4>
          <p className="text-xs text-zinc-300 mb-2">{hoveredNode.desc}</p>
          <div className="flex gap-2">
             <div className="flex flex-col">
               <span className="text-[9px] text-zinc-500 uppercase">Relevance</span>
               <div className="w-12 h-1 bg-zinc-800 rounded overflow-hidden">
                 <div className="h-full bg-blue-500" style={{width: `${(hoveredNode.relevance || 0) * 10}%`}}></div>
               </div>
             </div>
             <div className="flex flex-col">
               <span className="text-[9px] text-zinc-500 uppercase">Popularity</span>
               <div className="w-12 h-1 bg-zinc-800 rounded overflow-hidden">
                 <div className="h-full bg-green-500" style={{width: `${(hoveredNode.popularity || 0) * 10}%`}}></div>
               </div>
             </div>
          </div>
        </div>
      )}
      
      {/* Zoom Controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-20">
        <button onClick={handleZoomIn} className="p-2 bg-zinc-900 border border-zinc-700 rounded-t text-zinc-400 hover:text-white hover:bg-zinc-800"><ZoomIn className="w-4 h-4" /></button>
        <button onClick={handleResetZoom} className="p-2 bg-zinc-900 border-x border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800"><Maximize className="w-4 h-4" /></button>
        <button onClick={handleZoomOut} className="p-2 bg-zinc-900 border border-zinc-700 rounded-b text-zinc-400 hover:text-white hover:bg-zinc-800"><ZoomOut className="w-4 h-4" /></button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-2 text-[10px] bg-black/60 backdrop-blur p-2 rounded border border-zinc-800/50 pointer-events-none select-none">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-black/50" style={{backgroundColor: COLORS.nodeGroup1}}></span> Core Themes</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-black/50" style={{backgroundColor: COLORS.nodeGroup2}}></span> Major Concepts</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-black/50" style={{backgroundColor: COLORS.nodeGroup3}}></span> Arguments</div>
        <div className="mt-1 pt-1 border-t border-zinc-700/50 text-zinc-500 flex items-center gap-1">
           <MousePointer2 className="w-3 h-3" /> Double Click for Detail
        </div>
      </div>
    </div>
  );
};

export default ForceGraph;