// @ts-nocheck
import {
  removeAllChildren,
  getBasePath,
  getFullSlugFromUrl,
  simplifySlug,
  resolveBasePath,
} from "@quartz-community/utils";

(function () {
  function getSlugFromUrl() {
    var slug = getFullSlugFromUrl();
    var base = getBasePath();
    if (base && slug.startsWith(base.replace(/^\//, ""))) {
      slug = slug.slice(base.replace(/^\//, "").length);
      if (slug.startsWith("/")) slug = slug.slice(1);
    }
    return slug;
  }

  function loadScript(src) {
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.crossOrigin = "anonymous";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  Promise.all([
    loadScript("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"),
    loadScript("https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.js"),
  ])
    .then(function () {
      initGraph();
    })
    .catch(function (err) {
      console.error("[Graph] Failed to load libraries:", err);
      var containers = document.querySelectorAll(".graph-container");
      for (var i = 0; i < containers.length; i++) {
        containers[i].textContent = "Graph could not load. Check your network connection.";
        containers[i].style.display = "flex";
        containers[i].style.alignItems = "center";
        containers[i].style.justifyContent = "center";
        containers[i].style.color = "var(--gray)";
        containers[i].style.fontSize = "0.9rem";
      }
    });

  function initGraph() {
    var d3 = window.d3;
    var PIXI = window.PIXI;

    if (!d3 || !PIXI) {
      console.error("[Graph] Libraries not loaded");
      return;
    }

    var localStorageKey = "graph-visited";

    function getVisited() {
      return new Set(JSON.parse(localStorage.getItem(localStorageKey) || "[]"));
    }

    function addToVisited(slug) {
      var visited = getVisited();
      visited.add(slug);
      localStorage.setItem(localStorageKey, JSON.stringify(Array.from(visited)));
    }

    // Resolves CSS color values containing calc()/var() that PixiJS cannot parse.
    // Uses a temp DOM element so the browser's CSS engine evaluates the expression.
    function resolveColor(value, fallback) {
      if (!value) return fallback;
      var el = document.createElement("div");
      el.style.color = value;
      el.style.position = "absolute";
      el.style.visibility = "hidden";
      document.body.appendChild(el);
      var resolved = getComputedStyle(el).color;
      el.remove();
      return resolved || fallback;
    }

    async function renderGraph(graph, fullSlug, renderGeneration) {
      var slug = simplifySlug(fullSlug);
      if (slug === "") slug = "index";
      var visited = getVisited();
      removeAllChildren(graph);

      if (renderGeneration !== undefined && renderGeneration !== currentRenderGeneration) {
        console.log("[Graph] Stale render, skipping");
        return function () {};
      }

      var config = JSON.parse(graph.dataset["cfg"] || "{}");
      var enableDrag = config.drag;
      var enableZoom = config.zoom;
      var depth = config.depth;
      var scale = config.scale || 1;
      var repelForce = config.repelForce || 0.5;
      var centerForce = config.centerForce || 0.3;
      var linkDistance = config.linkDistance || 30;
      var fontSize = config.fontSize || 0.6;
      var opacityScale = config.opacityScale || 1;
      var removeTags = config.removeTags || [];
      var showTags = config.showTags;
      var focusOnHover = config.focusOnHover;
      var enableRadial = config.enableRadial;
      // Fork additions (local graph): always-visible labels + relationship-kind edges + legend.
      var showLabels = config.showLabels === true;
      var showLegend = config.legend === true;
      // Fork addition (global graph, E5): group nodes into named, colour-coded
      // clusters derived from the ontology (tags) with folder prefix as fallback,
      // and render each cluster's name as a region label at its centroid.
      var enableClusters = config.clusters === true;

      var data;
      try {
        var dataRaw = await fetchData;
        data = new Map();
        for (var key in dataRaw) {
          data.set(simplifySlug(key), dataRaw[key]);
        }
      } catch (err) {
        console.error("[Graph] Error loading data:", err);
        return function () {};
      }

      var width = graph.offsetWidth;
      var height = Math.max(graph.offsetHeight, 250);

      var links = [];
      var allTags = [];
      var validLinks = new Set(data.keys());

      data.forEach(function (details, source) {
        var outgoing = details.links || [];
        for (var i = 0; i < outgoing.length; i++) {
          var dest = simplifySlug(outgoing[i]);
          if (validLinks.has(dest)) {
            links.push({ source: source, target: dest });
          }
        }

        if (showTags) {
          var tags = details.tags || [];
          for (var i = 0; i < tags.length; i++) {
            var tag = tags[i];
            if (removeTags.indexOf(tag) === -1) {
              var tagSlug = simplifySlug("tags/" + tag);
              if (allTags.indexOf(tagSlug) === -1) {
                allTags.push(tagSlug);
              }
              links.push({ source: source, target: tagSlug });
            }
          }
        }
      });

      var neighbourhood = new Set();
      if (depth >= 0) {
        var queue = [slug];
        var seen = new Set([slug]);
        for (var d = 0; d <= depth && queue.length > 0; d++) {
          var nextQueue = [];
          for (var qi = 0; qi < queue.length; qi++) {
            var cur = queue[qi];
            neighbourhood.add(cur);
            for (var li = 0; li < links.length; li++) {
              var link = links[li];
              if (link.source === cur && !seen.has(link.target)) {
                seen.add(link.target);
                nextQueue.push(link.target);
              }
              if (link.target === cur && !seen.has(link.source)) {
                seen.add(link.source);
                nextQueue.push(link.source);
              }
            }
          }
          queue = nextQueue;
        }
      } else {
        validLinks.forEach(function (id) {
          neighbourhood.add(id);
        });
        for (var i = 0; i < allTags.length; i++) {
          neighbourhood.add(allTags[i]);
        }
      }

      var nodes = [];
      var nodeMap = new Map();
      neighbourhood.forEach(function (url) {
        var isTag = url.startsWith("tags/");
        var text = isTag ? "#" + url.substring(5) : data.get(url)?.title || url;
        var nodeTags = isTag ? [] : data.get(url)?.tags || [];
        var node = {
          id: url,
          text: text,
          tags: nodeTags,
          x: Math.random() * width - width / 2,
          y: Math.random() * height - height / 2,
          vx: 0,
          vy: 0,
        };
        nodes.push(node);
        nodeMap.set(url, node);
      });

      // Classify each link's relationship kind RELATIVE TO the current page (slug).
      // links are directional: source has an outgoing wikilink/tag-edge to target.
      //   outgoing — slug -> neighbour (this page links out)
      //   incoming — neighbour -> slug (a backlink into this page)
      //   tag      — either endpoint is a tags/ node (ontology co-membership)
      //   other    — neighbour <-> neighbour, not touching the current page
      function classifyLink(srcId, dstId) {
        var srcTag = srcId.startsWith("tags/");
        var dstTag = dstId.startsWith("tags/");
        if (srcTag || dstTag) return "tag";
        if (srcId === slug) return "outgoing";
        if (dstId === slug) return "incoming";
        return "other";
      }

      var graphLinks = [];
      for (var i = 0; i < links.length; i++) {
        var link = links[i];
        if (neighbourhood.has(link.source) && neighbourhood.has(link.target)) {
          var sourceNode = nodeMap.get(link.source);
          var targetNode = nodeMap.get(link.target);
          if (sourceNode && targetNode) {
            graphLinks.push({
              source: sourceNode,
              target: targetNode,
              kind: classifyLink(link.source, link.target),
            });
          }
        }
      }

      var styles = getComputedStyle(document.documentElement);
      var secondary = resolveColor(styles.getPropertyValue("--secondary").trim(), "#c792ea");
      var tertiary = resolveColor(styles.getPropertyValue("--tertiary").trim(), "#82aaff");
      var gray = resolveColor(styles.getPropertyValue("--gray").trim(), "#6c6c6c");
      var lightgray = resolveColor(styles.getPropertyValue("--lightgray").trim(), "#d4d4d4");
      var dark = resolveColor(styles.getPropertyValue("--dark").trim(), "#1a1a1a");
      var light = resolveColor(styles.getPropertyValue("--light").trim(), "#f5f5f5");
      var bodyFont = styles.getPropertyValue("--bodyFont").trim() || "inherit";

      // ---- Named clusters (global graph, E5) ----------------------------------
      // Derive each node's cluster from the ontology (tags) with folder prefix as
      // the fallback, assign a stable colour per cluster, and (later) draw the
      // cluster name as a region label at its centroid.
      //
      // Cluster derivation is precedence-ordered:
      //   1. ontology  — a node tag that names a known cluster wins (e.g. tags:
      //      [spec] -> "specs"). The emitted ContentIndex carries `tags` but not
      //      frontmatter `type:`, so tags are the available ontology signal.
      //   2. folder    — top-level slug prefix maps to a cluster (the path that
      //      matters today, since the corpus is mostly untagged).
      //   3. core      — root-level docs (README/AGENTS/CLAUDE/ONBOARDING/index).
      //
      // Tag pages (tags/*) form their own "tags" cluster.
      var clusterNames = [
        "specs",
        "tools",
        "agents",
        "plans",
        "skills",
        "rules",
        "setup",
        "claude",
        "core",
        "tags",
      ];
      // Map a recognised ontology tag to its cluster. A tag whose (singular or
      // plural) form names a cluster takes precedence over the folder fallback.
      var tagToCluster = {
        spec: "specs",
        specs: "specs",
        tool: "tools",
        tools: "tools",
        agent: "agents",
        agents: "agents",
        plan: "plans",
        plans: "plans",
        skill: "skills",
        skills: "skills",
        rule: "rules",
        rules: "rules",
        setup: "setup",
        claude: "claude",
        core: "core",
      };

      function clusterFromFolder(id) {
        if (id.startsWith("tags/")) return "tags";
        if (id.indexOf("openspec/") === 0) return "specs";
        if (id.indexOf("setup/tools/") === 0) return "tools";
        if (id.indexOf("setup/agents/") === 0) return "agents";
        if (id.indexOf("setup/plans/") === 0) return "plans";
        if (id.indexOf("setup/") === 0) return "setup";
        if (id.indexOf(".claude/skills/") === 0) return "skills";
        if (id.indexOf(".claude/") === 0) return "claude";
        if (id.indexOf("rules/") === 0) return "rules";
        // No top-level folder segment -> a root-level document.
        if (id.indexOf("/") === -1) return "core";
        return "setup";
      }

      function clusterForNode(node) {
        var tags = node.tags || [];
        for (var ti = 0; ti < tags.length; ti++) {
          var key = String(tags[ti]).toLowerCase();
          if (tagToCluster[key]) return tagToCluster[key];
        }
        return clusterFromFolder(node.id);
      }

      // Fixed, ordered palette keyed by cluster name (index into clusterNames).
      // Distinct hues chosen for separability on both light and dark backgrounds;
      // resolved through resolveColor so PixiJS gets a parseable value.
      var clusterPalette = {
        specs: "#7c6ff0", // indigo
        tools: "#2bb3a3", // teal
        agents: "#e8913a", // amber
        plans: "#d6588a", // magenta-rose
        skills: "#3a8fe8", // blue
        rules: "#c25b5b", // brick
        setup: "#5fae5f", // green
        claude: "#a07cd6", // violet
        core: "#d4b13a", // gold
        tags: "#8a8a8a", // gray (tag pages)
      };
      var clusterColors = {};
      for (var ci = 0; ci < clusterNames.length; ci++) {
        var cn = clusterNames[ci];
        clusterColors[cn] = resolveColor(clusterPalette[cn], clusterPalette[cn]);
      }

      // Tag each node with its cluster and track which clusters are present.
      var presentClusters = {};
      for (var ni = 0; ni < nodes.length; ni++) {
        var cluster = clusterForNode(nodes[ni]);
        nodes[ni].cluster = cluster;
        presentClusters[cluster] = true;
      }

      // Relationship-kind edge palette. Outgoing/incoming take theme accents so they
      // track light/dark; tag co-membership reuses the tag accent (secondary).
      var linkColors = {
        outgoing: tertiary, // this page -> neighbour
        incoming: resolveColor("#e8a13a", "#e8a13a"), // neighbour -> this page (backlink)
        tag: secondary, // shared tag (ontology co-membership)
        other: lightgray, // neighbour <-> neighbour
      };
      function linkKindColor(kind) {
        return linkColors[kind] || lightgray;
      }

      var app = new PIXI.Application();
      await app.init({
        width: width,
        height: height,
        antialias: true,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        eventMode: "static",
      });

      graph.appendChild(app.canvas);

      var stage = new PIXI.Container();
      app.stage.addChild(stage);

      var simulation = d3
        .forceSimulation(nodes)
        .force("charge", d3.forceManyBody().strength(-100 * repelForce))
        .force("center", d3.forceCenter().strength(centerForce))
        .force("link", d3.forceLink(graphLinks).distance(linkDistance))
        .force(
          "collide",
          d3
            .forceCollide()
            .radius(function (d) {
              var numLinks = 0;
              for (var i = 0; i < graphLinks.length; i++) {
                if (graphLinks[i].source.id === d.id || graphLinks[i].target.id === d.id) {
                  numLinks++;
                }
              }
              return 2 + Math.sqrt(numLinks);
            })
            .iterations(3),
        );

      // Cluster anchors (E5): place each present cluster on a ring around the
      // centre and pull its members toward that anchor so the regions separate.
      var clusterAnchors = {};
      if (enableClusters) {
        var present = [];
        for (var pi = 0; pi < clusterNames.length; pi++) {
          if (presentClusters[clusterNames[pi]]) present.push(clusterNames[pi]);
        }
        var anchorRadius = (Math.min(width, height) / 2) * 0.7;
        for (var ai = 0; ai < present.length; ai++) {
          var ang = (2 * Math.PI * ai) / Math.max(present.length, 1) - Math.PI / 2;
          clusterAnchors[present[ai]] = {
            x: Math.cos(ang) * anchorRadius,
            y: Math.sin(ang) * anchorRadius,
          };
        }
        // Custom positioning force: ease each node toward its cluster anchor.
        var clusterStrength = 0.12;
        var clusterForce = function (alpha) {
          for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var anchor = clusterAnchors[n.cluster];
            if (!anchor) continue;
            n.vx += (anchor.x - n.x) * clusterStrength * alpha;
            n.vy += (anchor.y - n.y) * clusterStrength * alpha;
          }
        };
        simulation.force("cluster", clusterForce);
      } else if (enableRadial) {
        var radius = (Math.min(width, height) / 2) * 0.8;
        simulation.force("radial", d3.forceRadial(radius).strength(0.2));
      }

      // Cluster region labels sit BEHIND links/nodes so they read like the
      // labelled regions on a map (large, semi-transparent, in cluster colour).
      var clusterLabelsContainer = new PIXI.Container();
      var linkContainer = new PIXI.Container();
      var nodesContainer = new PIXI.Container();
      var labelsContainer = new PIXI.Container();
      stage.addChild(clusterLabelsContainer);
      stage.addChild(linkContainer);
      stage.addChild(nodesContainer);
      stage.addChild(labelsContainer);

      // One text element per present cluster, positioned at its centroid each tick.
      var clusterLabelData = [];
      if (enableClusters) {
        for (var cli = 0; cli < clusterNames.length; cli++) {
          var cname = clusterNames[cli];
          if (!presentClusters[cname]) continue;
          var clabel = new PIXI.Text({
            text: cname,
            style: {
              fontSize: fontSize * 40,
              fill: clusterColors[cname] || gray,
              fontFamily: bodyFont,
              fontWeight: "700",
            },
            resolution: window.devicePixelRatio * 2,
          });
          clabel.anchor.set(0.5, 0.5);
          clabel.alpha = 0.28;
          clusterLabelsContainer.addChild(clabel);
          clusterLabelData.push({ cluster: cname, label: clabel });
        }
      }

      var nodeRenderData = [];
      var linkRenderData = [];
      var hoveredNodeId = null;
      var hoveredNeighbours = new Set();
      var dragStartTime = 0;
      var dragging = false;
      var currentTransform = d3.zoomIdentity;

      function nodeRadius(d) {
        var numLinks = 0;
        for (var i = 0; i < graphLinks.length; i++) {
          if (graphLinks[i].source.id === d.id || graphLinks[i].target.id === d.id) {
            numLinks++;
          }
        }
        return 2 + Math.sqrt(numLinks);
      }

      function nodeColor(d) {
        // Global graph (E5): fill by cluster so each region reads as a coloured
        // area. The current page still gets the accent so it stands out.
        if (enableClusters) {
          if (d.id === slug) return secondary;
          return clusterColors[d.cluster] || gray;
        }
        var isCurrent = d.id === slug;
        if (isCurrent) {
          return secondary;
        } else if (visited.has(d.id) || d.id.startsWith("tags/")) {
          return tertiary;
        } else {
          return gray;
        }
      }

      function updateHoverInfo(newHoveredId) {
        hoveredNodeId = newHoveredId;

        if (newHoveredId === null) {
          hoveredNeighbours = new Set();
          for (var i = 0; i < nodeRenderData.length; i++) {
            nodeRenderData[i].active = false;
          }
          for (var i = 0; i < linkRenderData.length; i++) {
            linkRenderData[i].active = false;
          }
        } else {
          hoveredNeighbours = new Set();

          for (var i = 0; i < linkRenderData.length; i++) {
            var linkData = linkRenderData[i].simulationData;
            if (linkData.source.id === newHoveredId || linkData.target.id === newHoveredId) {
              hoveredNeighbours.add(linkData.source.id);
              hoveredNeighbours.add(linkData.target.id);
              linkRenderData[i].active = true;
            } else {
              linkRenderData[i].active = false;
            }
          }

          hoveredNeighbours.add(newHoveredId);

          for (var i = 0; i < nodeRenderData.length; i++) {
            if (hoveredNeighbours.has(nodeRenderData[i].simulationData.id)) {
              nodeRenderData[i].active = true;
            } else {
              nodeRenderData[i].active = false;
            }
          }
        }
      }

      function renderLinks() {
        for (var i = 0; i < linkRenderData.length; i++) {
          var linkData = linkRenderData[i];
          var alpha = 1;
          if (hoveredNodeId !== null) {
            alpha = linkData.active ? 1 : 0.2;
          }
          linkData.alpha = alpha;
          // Keep the relationship-kind colour so it stays discoverable at rest;
          // "other" edges stay neutral, brightening to gray only on hover.
          var kind = linkData.simulationData.kind;
          if (kind === "other") {
            linkData.color = linkData.active ? gray : lightgray;
          } else {
            linkData.color = linkKindColor(kind);
          }
        }
      }

      function renderLabels() {
        var defaultScale = 1 / scale;
        var activeScale = defaultScale * 1.1;

        for (var i = 0; i < nodeRenderData.length; i++) {
          var nodeData = nodeRenderData[i];
          if (hoveredNodeId === nodeData.simulationData.id) {
            nodeData.label.alpha = 1;
            nodeData.label.scale.set(activeScale);
          } else {
            nodeData.label.scale.set(defaultScale);
          }
        }
      }

      function renderNodes() {
        for (var i = 0; i < nodeRenderData.length; i++) {
          var nodeData = nodeRenderData[i];
          var alpha = 1;
          if (hoveredNodeId !== null && focusOnHover) {
            alpha = nodeData.active ? 1 : 0.2;
          }
          nodeData.gfx.alpha = alpha;
        }
      }

      function renderPixiFromD3() {
        renderNodes();
        renderLinks();
        renderLabels();
      }

      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var nodeId = node.id;
        var isTagNode = nodeId.startsWith("tags/");
        var radius = nodeRadius(node);
        var color = nodeColor(node);

        var label = new PIXI.Text({
          text: node.text,
          style: {
            fontSize: fontSize * 15,
            fill: dark,
            fontFamily: bodyFont,
          },
          resolution: window.devicePixelRatio * 4,
        });
        label.anchor.set(0.5, 1.2);
        // showLabels (local graph) keeps every label visible without hover/zoom.
        label.alpha = showLabels ? 1 : 0;
        label.scale.set(1 / scale);
        labelsContainer.addChild(label);

        var gfx = new PIXI.Graphics();
        gfx.circle(0, 0, radius);
        // In cluster mode every node (tags included) takes its cluster fill so
        // the regions read uniformly; otherwise keep the local-graph styling.
        gfx.fill({ color: enableClusters ? color : isTagNode ? light : color });
        if (isTagNode && !enableClusters) {
          gfx.stroke({ width: 2, color: tertiary });
        }

        gfx.eventMode = "static";
        gfx.cursor = "pointer";
        gfx.label = nodeId;

        (function (n, g, labelRef) {
          var oldLabelOpacity = 0;
          g.on("pointerover", function (e) {
            updateHoverInfo(n.id);
            oldLabelOpacity = labelRef.alpha;
            if (!dragging) {
              renderPixiFromD3();
            }
          });

          g.on("pointerleave", function () {
            updateHoverInfo(null);
            labelRef.alpha = oldLabelOpacity;
            if (!dragging) {
              renderPixiFromD3();
            }
          });
        })(node, gfx, label);

        nodesContainer.addChild(gfx);

        nodeRenderData.push({
          simulationData: node,
          gfx: gfx,
          label: label,
          color: color,
          alpha: 1,
          active: false,
        });
      }

      for (var i = 0; i < graphLinks.length; i++) {
        var link = graphLinks[i];
        var gfx = new PIXI.Graphics();
        gfx.eventMode = "none";
        linkContainer.addChild(gfx);

        linkRenderData.push({
          simulationData: link,
          gfx: gfx,
          color: lightgray,
          alpha: 1,
          active: false,
        });
      }

      if (enableDrag) {
        var dragSubject = function (event) {
          var mouseX = (event.x - currentTransform.x) / currentTransform.k;
          var mouseY = (event.y - currentTransform.y) / currentTransform.k;

          for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var dx = mouseX - n.x - width / 2;
            var dy = mouseY - n.y - height / 2;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var rad = nodeRadius(n);
            if (dist < rad + 5) {
              return n;
            }
          }
          return null;
        };

        var dragStarted = function (event) {
          if (!event.active) simulation.alphaTarget(1).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
          var mouseSimX = (event.x - currentTransform.x) / currentTransform.k - width / 2;
          var mouseSimY = (event.y - currentTransform.y) / currentTransform.k - height / 2;
          event.subject.__dragOffset = {
            x: mouseSimX - event.subject.x,
            y: mouseSimY - event.subject.y,
          };
          dragStartTime = Date.now();
          dragging = true;
          hoveredNodeId = event.subject.id;
        };

        var dragDragged = function (event) {
          var mouseSimX = (event.x - currentTransform.x) / currentTransform.k - width / 2;
          var mouseSimY = (event.y - currentTransform.y) / currentTransform.k - height / 2;
          event.subject.fx = mouseSimX - event.subject.__dragOffset.x;
          event.subject.fy = mouseSimY - event.subject.__dragOffset.y;
        };

        var dragEnded = function (event) {
          if (!event.active) simulation.alphaTarget(0);
          event.subject.fx = null;
          event.subject.fy = null;
          dragging = false;
          updateHoverInfo(null);
          renderPixiFromD3();

          if (Date.now() - dragStartTime < 500) {
            var target = resolveBasePath(event.subject.id);
            window.location.href = target;
          }
        };

        var drag = d3
          .drag()
          .container(app.canvas)
          .subject(dragSubject)
          .on("start", dragStarted)
          .on("drag", dragDragged)
          .on("end", dragEnded);

        d3.select(app.canvas).call(drag);
      } else {
        for (var i = 0; i < nodeRenderData.length; i++) {
          (function (nodeData) {
            nodeData.gfx.on("click", function () {
              var target = resolveBasePath(nodeData.simulationData.id);
              window.location.href = target;
            });
          })(nodeRenderData[i]);
        }
      }

      if (enableZoom) {
        var zoomed = function (event) {
          currentTransform = event.transform;
          stage.scale.set(currentTransform.k, currentTransform.k);
          stage.position.set(currentTransform.x, currentTransform.y);

          var newScale = currentTransform.k * opacityScale;
          var scaleOpacity = Math.max((newScale - 1) / 3.75, 0);

          var activeLabels = [];
          for (var i = 0; i < nodeRenderData.length; i++) {
            if (nodeRenderData[i].active) {
              activeLabels.push(nodeRenderData[i].label);
            }
          }

          for (var i = 0; i < labelsContainer.children.length; i++) {
            var label = labelsContainer.children[i];
            if (activeLabels.indexOf(label) === -1) {
              // When labels are pinned visible, never fade below full opacity on zoom.
              label.alpha = showLabels ? 1 : scaleOpacity;
            }
          }
        };

        var zoom = d3
          .zoom()
          .extent([
            [0, 0],
            [width, height],
          ])
          .scaleExtent([0.25, 4])
          .on("zoom", zoomed);

        d3.select(app.canvas).call(zoom);
      }

      var stopAnimation = false;
      function animate() {
        if (stopAnimation) return;

        for (var i = 0; i < nodeRenderData.length; i++) {
          var n = nodeRenderData[i];
          var x = n.simulationData.x;
          var y = n.simulationData.y;
          if (x != null && y != null) {
            n.gfx.position.set(x + width / 2, y + height / 2);
            if (n.label) {
              n.label.position.set(x + width / 2, y + height / 2);
            }
          }
        }

        // Re-centre each cluster region label on the live centroid of its nodes.
        if (clusterLabelData.length > 0) {
          var sums = {};
          for (var ci2 = 0; ci2 < clusterLabelData.length; ci2++) {
            sums[clusterLabelData[ci2].cluster] = { x: 0, y: 0, n: 0 };
          }
          for (var i = 0; i < nodes.length; i++) {
            var nd = nodes[i];
            var acc = sums[nd.cluster];
            if (acc && nd.x != null && nd.y != null) {
              acc.x += nd.x;
              acc.y += nd.y;
              acc.n++;
            }
          }
          for (var ci2 = 0; ci2 < clusterLabelData.length; ci2++) {
            var entry = clusterLabelData[ci2];
            var acc2 = sums[entry.cluster];
            if (acc2 && acc2.n > 0) {
              entry.label.position.set(acc2.x / acc2.n + width / 2, acc2.y / acc2.n + height / 2);
              entry.label.visible = true;
            } else {
              entry.label.visible = false;
            }
          }
        }

        for (var i = 0; i < linkRenderData.length; i++) {
          var l = linkRenderData[i];
          var linkData = l.simulationData;
          var sx = linkData.source.x;
          var sy = linkData.source.y;
          var tx = linkData.target.x;
          var ty = linkData.target.y;
          if (sx != null && sy != null && tx != null && ty != null) {
            var ax = sx + width / 2;
            var ay = sy + height / 2;
            var bx = tx + width / 2;
            var by = ty + height / 2;
            var kind = linkData.kind;
            l.gfx.clear();

            if (kind === "tag") {
              // Dashed stroke distinguishes ontology co-membership edges.
              var ddx = bx - ax;
              var ddy = by - ay;
              var dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
              var ux = ddx / dlen;
              var uy = ddy / dlen;
              var dash = 5;
              var gap = 4;
              var pos = 0;
              l.gfx.moveTo(ax, ay);
              while (pos < dlen) {
                var seg = Math.min(dash, dlen - pos);
                l.gfx.moveTo(ax + ux * pos, ay + uy * pos);
                l.gfx.lineTo(ax + ux * (pos + seg), ay + uy * (pos + seg));
                pos += dash + gap;
              }
              l.gfx.stroke({ alpha: l.alpha, width: 1, color: l.color });
            } else {
              l.gfx.moveTo(ax, ay);
              l.gfx.lineTo(bx, by);
              l.gfx.stroke({ alpha: l.alpha, width: 1, color: l.color });

              // Directional arrowhead at the target end for outgoing/incoming edges,
              // offset by the target radius so it rests on the node's rim.
              if (kind === "outgoing" || kind === "incoming") {
                var dx = bx - ax;
                var dy = by - ay;
                var len = Math.sqrt(dx * dx + dy * dy) || 1;
                var nx = dx / len;
                var ny = dy / len;
                var tipPad = nodeRadius(linkData.target) + 1.5;
                var tipX = bx - nx * tipPad;
                var tipY = by - ny * tipPad;
                var ah = 5; // arrow length
                var aw = 2.6; // half-width
                var baseX = tipX - nx * ah;
                var baseY = tipY - ny * ah;
                var perpX = -ny;
                var perpY = nx;
                l.gfx.moveTo(tipX, tipY);
                l.gfx.lineTo(baseX + perpX * aw, baseY + perpY * aw);
                l.gfx.lineTo(baseX - perpX * aw, baseY - perpY * aw);
                l.gfx.lineTo(tipX, tipY);
                l.gfx.fill({ alpha: l.alpha, color: l.color });
              }
            }
          }
        }

        requestAnimationFrame(animate);
      }

      simulation.on("tick", function () {});
      simulation.restart();
      renderPixiFromD3();
      animate();

      return function () {
        stopAnimation = true;
        simulation.stop();
        try {
          app.destroy(true);
        } catch (_) {
          // PixiJS may throw if WebGL context was already lost.
        }
      };
    }

    var localCleanups = [];
    var globalCleanups = [];
    var currentRenderGeneration = 0;

    function cleanupLocal() {
      for (var i = 0; i < localCleanups.length; i++) {
        localCleanups[i]();
      }
      localCleanups = [];
    }

    function cleanupGlobal() {
      for (var i = 0; i < globalCleanups.length; i++) {
        globalCleanups[i]();
      }
      globalCleanups = [];
    }

    var globalContainers = [];
    var globalIcons = [];
    var documentClickHandler = null;
    var documentKeydownHandler = null;
    var iconClickHandler = null;

    function hideGlobalGraph() {
      cleanupGlobal();
      for (var i = 0; i < globalContainers.length; i++) {
        globalContainers[i].classList.remove("active");
        var sidebar = globalContainers[i].closest(".sidebar");
        if (sidebar) {
          sidebar.style.zIndex = "";
        }
      }
    }

    function anyGlobalGraphActive() {
      for (var i = 0; i < globalContainers.length; i++) {
        if (globalContainers[i].classList.contains("active")) {
          return true;
        }
      }
      return false;
    }

    function showGlobalGraph() {
      cleanupGlobal();
      var currentSlug = getSlugFromUrl();
      for (var i = 0; i < globalContainers.length; i++) {
        var container = globalContainers[i];
        container.classList.add("active");
        var sidebar = container.closest(".sidebar");
        if (sidebar) {
          sidebar.style.zIndex = "1";
        }

        var graphContainer = container.querySelector(".global-graph-container");
        if (graphContainer) {
          (function (gc) {
            renderGraph(gc, currentSlug, undefined)
              .then(function (cleanup) {
                globalCleanups.push(cleanup);
              })
              .catch(function (err) {
                console.error("[Graph] Global render error:", err);
              });
          })(graphContainer);
        }
      }
    }

    function toggleGlobalGraph() {
      if (anyGlobalGraphActive()) {
        hideGlobalGraph();
      } else {
        showGlobalGraph();
      }
    }

    function renderLocal() {
      cleanupLocal();
      var thisGeneration = ++currentRenderGeneration;
      var slug = getSlugFromUrl();
      addToVisited(slug);

      var localContainers = document.querySelectorAll(".graph-container");
      for (var i = 0; i < localContainers.length; i++) {
        (function (container) {
          renderGraph(container, slug, thisGeneration)
            .then(function (cleanup) {
              if (thisGeneration === currentRenderGeneration) {
                localCleanups.push(cleanup);
              }
            })
            .catch(function (err) {
              console.error("[Graph] Local render error:", err);
            });
        })(localContainers[i]);
      }
    }

    function handleNav(e) {
      var slug = e.detail ? e.detail.url : getSlugFromUrl();
      addToVisited(simplifySlug(slug));

      renderLocal();

      globalContainers = Array.from(document.querySelectorAll(".global-graph-outer"));

      if (iconClickHandler) {
        for (var i = 0; i < globalIcons.length; i++) {
          globalIcons[i].removeEventListener("click", iconClickHandler);
        }
      }

      globalIcons = Array.from(document.querySelectorAll(".global-graph-icon"));
      iconClickHandler = function () {
        toggleGlobalGraph();
      };
      for (var i = 0; i < globalIcons.length; i++) {
        globalIcons[i].addEventListener("click", iconClickHandler);
      }

      if (documentClickHandler) {
        document.removeEventListener("click", documentClickHandler);
      }
      documentClickHandler = function (e) {
        if (anyGlobalGraphActive()) {
          var inContainer = e.target.closest(".global-graph-container");
          var inIcon = e.target.closest(".global-graph-icon");
          if (!inContainer && !inIcon) {
            hideGlobalGraph();
          }
        }
      };
      document.addEventListener("click", documentClickHandler);

      if (documentKeydownHandler) {
        document.removeEventListener("keydown", documentKeydownHandler);
      }
      documentKeydownHandler = function (e) {
        if (e.key === "Escape") {
          if (anyGlobalGraphActive()) {
            hideGlobalGraph();
          }
          return;
        }

        if (e.key === "g" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          e.preventDefault();
          toggleGlobalGraph();
        }
      };
      document.addEventListener("keydown", documentKeydownHandler);

      if (anyGlobalGraphActive()) {
        showGlobalGraph();
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        handleNav({ detail: { url: getSlugFromUrl() } });
      });
    } else {
      handleNav({ detail: { url: getSlugFromUrl() } });
    }
    document.addEventListener("prenav", function () {
      cleanupLocal();
      cleanupGlobal();
    });
    document.addEventListener("nav", handleNav);
    document.addEventListener("render", handleNav);

    function handleThemeChange() {
      renderLocal();
      if (anyGlobalGraphActive()) {
        showGlobalGraph();
      }
    }
    document.addEventListener("themechange", handleThemeChange);
  }
})();
