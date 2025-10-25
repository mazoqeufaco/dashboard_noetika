function R = cluster_1d_sigma(x, s, opts)
% Clusterização 1D com incerteza por ponto, sem toolbox.
% Distância: |xi - xj| / sqrt(si^2 + sj^2)
% Algoritmo: DBSCAN com epsilon escolhido automaticamente por joelho da k-dist.
%
% Inputs:
%   x    : Nx1 valores
%   s    : Nx1 incertezas (sigma) > 0
%   opts : struct (opcional)
%       .MinPts    (default = max(3, round(log(numel(x)))))
%       .Eps       (default = auto pelo joelho da k-dist)
%       .KneeK     (default = MinPts)     % k p/ curva k-dist
%       .EpsBounds (default = [1.0 4.0])  % clamp do epsilon em sigmas
%       .Verbose   (default = true)
%
% Saída R:
%   .idx      : rótulos de cluster (1..K), 0 = ruído
%   .eps      : epsilon usado (em "sigmas")
%   .MinPts   : MinPts usado
%   .D        : matriz de distâncias (em "sigmas")
%   .order    : ordem dos pontos por x (só p/ referência)
%   .knee     : struct com k-dist, posição do joelho etc.

  arguments
    x (:,1) double
    s (:,1) double
    opts.MinPts double = max(3, round(log(max(numel(x),3))))
    opts.Eps double = NaN
    opts.KneeK double = NaN
    opts.EpsBounds (1,2) double = [1.0 4.0]
    opts.Verbose logical = true
  end

  x = x(:); s = s(:);
  N = numel(x);
  assert(numel(s)==N, 'x e s devem ter o mesmo tamanho.');
  s = max(s, eps); % evita zero

  % --- Matriz de distâncias em "sigmas combinados" ---
  % D_ij = |xi - xj| / sqrt(si^2 + sj^2)
  Xi = x .* ones(1,N);
  Xj = Xi';
  Si2 = (s.^2) * ones(1,N);
  Sj2 = Si2';
  D = abs(Xi - Xj) ./ sqrt(Si2 + Sj2);
  D(1:N+1:end) = 0;  % diagonal zero

  % --- Parâmetros ---
  MinPts = max(3, round(opts.MinPts));
  if isnan(opts.KneeK), KneeK = MinPts; else, KneeK = max(2, round(opts.KneeK)); end

  % --- Escolha automática do eps se não fornecido ---
  if isnan(opts.Eps)
    kd = kth_neighbor_dist(D, KneeK);   % k-dist por ponto (exclui self=0)
    [eps_auto, kneeInfo] = pick_knee(kd, opts.EpsBounds);
    eps = eps_auto;
    knee = kneeInfo;
  else
    eps = opts.Eps;
    knee = struct('kdist', [], 'idx_knee', NaN);
  end

  % --- DBSCAN com D pré-computada ---
  idx = local_dbscan_from_D(D, eps, MinPts);

  if opts.Verbose
    K = numel(unique(idx(idx>0)));
    fprintf('[cluster_1d_sigma] N=%d | eps=%.3f | MinPts=%d | clusters=%d | noise=%d\n', ...
      N, eps, MinPts, K, sum(idx==0));
  end

  R = struct('idx', idx, 'eps', eps, 'MinPts', MinPts, ...
             'D', D, 'order', [], 'knee', knee);
end

% ======= Helpers =======

function kd = kth_neighbor_dist(D, k)
% Retorna vetor N x 1 com a distância ao k-ésimo vizinho mais próximo
  N = size(D,1);
  kd = zeros(N,1);
  for i=1:N
    di = D(i,:);
    di(i) = inf;                 % ignora self
    di = sort(di, 'ascend');
    k2 = min(k, N-1);
    kd(i) = di(k2);
  end
  kd = sort(kd, 'ascend');       % típico no k-dist plot (ordenado)
end

function [eps, info] = pick_knee(kd_sorted, bounds)
% "Método do triângulo" (joelho) no vetor crescente kd_sorted.
% Retorna eps clampado em [bounds(1), bounds(2)].
  x = (1:numel(kd_sorted))';
  y = kd_sorted(:);
  if numel(y) < 3
    eps = median(y);
    info = struct('kdist', y, 'idx_knee', numel(y));
    return;
  end
  % reta de (x1,y1) a (xn,yn)
  x1 = x(1); y1 = y(1);
  x2 = x(end); y2 = y(end);

  % distância perpendicular de cada ponto à reta
  num = abs( (y2-y1)*x - (x2-x1)*y + x2*y1 - y2*x1 );
  den = sqrt( (y2-y1)^2 + (x2-x1)^2 );
  d = num / max(den, eps);
  [~, idxKnee] = max(d);

  eps_raw = y(idxKnee);
  eps = min(max(eps_raw, bounds(1)), bounds(2));
  info = struct('kdist', y, 'idx_knee', idxKnee, 'eps_raw', eps_raw);
end

function labels = local_dbscan_from_D(D, eps, MinPts)
% DBSCAN simples a partir de uma matriz de distâncias simétrica D.
  N = size(D,1);
  UNVISITED = 0; NOISE = -1;
  labels = zeros(N,1);   % 0 = não visitado, -1 = ruído, 1..K = clusters
  clusterId = 0;

  % vizinhanças pré-calculadas
  Nbrs = cell(N,1);
  for i=1:N
    Nbrs{i} = find(D(i,:) <= eps);
    Nbrs{i}(Nbrs{i}==i) = []; % remove self
  end

  for i=1:N
    if labels(i) ~= UNVISITED, continue; end
    neighbors = Nbrs{i};
    if numel(neighbors) + 1 < MinPts   % +1 inclui o próprio ponto
      labels(i) = NOISE;
      continue;
    end
    clusterId = clusterId + 1;
    labels(i) = clusterId;

    % expand cluster
    S = neighbors(:)';
    while ~isempty(S)
      j = S(end); S(end) = [];
      if labels(j) == NOISE
        labels(j) = clusterId;
      end
      if labels(j) ~= UNVISITED
        continue;
      end
      labels(j) = clusterId;

      neighbors_j = Nbrs{j};
      if numel(neighbors_j) + 1 >= MinPts
        S = [S neighbors_j(:)']; %#ok<AGROW>
      end
    end
  end

  % normaliza: ruído vira 0, clusters 1..K
  uniq = unique(labels(labels>0));
  map = zeros(max(uniq,[],'all')+1,1);
  for k=1:numel(uniq)
    map(uniq(k)) = k;
  end
  labels(labels>0) = arrayfun(@(z) map(z+0), labels(labels>0));
  labels(labels<0) = 0;
end
