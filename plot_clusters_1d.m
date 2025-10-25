function plot_clusters_1d(x, s, idx)
  x = x(:); s = s(:); idx = idx(:);
  N = numel(x);
  K = max(idx);
  cmap = lines(max(K,7));

  figure('Color','w'); hold on; grid on; box on;
  % y fictício só pra separar pontos
  y = zeros(N,1);
  jitter = 0.02*range(x); if jitter==0, jitter=0.1; end

  for i=1:N
    k = idx(i);
    if k==0
      col = [0.5 0.5 0.5]; mkr = 'o'; ms = 36;
    else
      col = cmap(k,:);
      mkr = 'o'; ms = 48;
    end
    % barras de erro horizontais (±s)
    line([x(i)-s(i), x(i)+s(i)], [y(i), y(i)], 'Color', col, 'LineWidth',1.4);
    % ponto
    scatter(x(i), y(i), ms, col, 'filled', 'MarkerEdgeColor','k', 'LineWidth',0.5);
  end

  xlabel('valor');
  yticks([]); ylim([-1, 1]);
  title(sprintf('Clusters por DBSCAN (K=%d; cinza = ruído)', K));
end
