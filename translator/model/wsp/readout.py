"""A linear readout (multinomial logistic, L2, standardised inputs) of a decision from the writer's state."""
import numpy as np
import torch


def fit(X, Y, k, l2=1e-3, iters=300, balanced=True):
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Z = torch.tensor((X - mu) / sd, dtype=torch.float32)
    y = torch.tensor(Y, dtype=torch.long)
    cnt = np.bincount(Y, minlength=k).astype(np.float32)
    w = torch.tensor(np.where(cnt > 0, len(Y) / (k * np.maximum(cnt, 1)), 0.0), dtype=torch.float32) if balanced else None
    W = torch.zeros(Z.shape[1], k, requires_grad=True)
    b = torch.zeros(k, requires_grad=True)
    opt = torch.optim.LBFGS([W, b], max_iter=iters, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.cross_entropy(Z @ W + b, y, weight=w) + l2 * (W ** 2).sum()
        loss.backward()
        return loss
    opt.step(closure)
    Wd, bd = W.detach(), b.detach()

    def probs(X2):
        with torch.no_grad():
            return torch.softmax(torch.tensor((X2 - mu) / sd, dtype=torch.float32) @ Wd + bd, -1).numpy()
    probs.W, probs.b, probs.mu, probs.sd = Wd.numpy(), bd.numpy(), mu, sd
    return probs
